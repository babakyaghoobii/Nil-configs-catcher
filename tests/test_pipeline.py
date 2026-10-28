import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import URLError
from urllib.request import Request

from collector.pipeline import FetchError, MAX_SOURCE_BYTES, NoRedirects, fetch_source, load_sources, run, write_json

SOURCE = {"id": "test", "name": "Test source", "owner": "example", "repo": "public-configs", "ref": "main", "path": "configs/list.txt", "enabled": True}
NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


def uri(n):
    return f"trojan://password-{n}@example.com:443#Config-{n}"


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.sources([SOURCE])

    def tearDown(self):
        self.temporary.cleanup()

    def sources(self, sources):
        write_json(self.root / "sources.json", {"version": 1, "sources": sources})

    def read(self, path):
        return json.loads((self.root / path).read_text())

    def test_only_50_new_per_run_and_never_seen_again(self):
        fetch = lambda _: "\n".join(uri(n) for n in range(70))
        first = run(self.root, fetcher=fetch, now=NOW)
        self.assertEqual(first["added"], 50)
        self.assertEqual(first["deferredUnique"], 20)
        second = run(self.root, fetcher=fetch, now=NOW)
        self.assertEqual(second["added"], 20)
        third = run(self.root, fetcher=fetch, now=NOW)
        self.assertEqual(third["added"], 0)
        self.assertEqual(third["totalUnique"], 70)
        self.assertEqual(len(self.read("data/archive/2026-10.json")), 70)
        self.assertEqual(len(self.read("data/seen.json")), 70)
        self.assertEqual(len(self.read("public/data/history.json")), 3)

    def test_does_not_pad_or_fabricate(self):
        report = run(self.root, fetcher=lambda _: uri(1) + "\ninvalid", now=NOW)
        self.assertEqual(report["added"], 1)
        configs = self.read("public/data/configs.json")["configs"]
        self.assertEqual(configs[0]["uri"], uri(1))
        self.assertEqual(configs[0]["sources"][0]["id"], SOURCE["id"])
        self.assertEqual(configs[0]["firstSeenAt"], "2026-10-28T12:00:00Z")

    def test_dedup_across_sources_keeps_provenance(self):
        self.sources([SOURCE, {**SOURCE, "id": "second", "name": "Second"}])
        report = run(self.root, fetcher=lambda _: uri(1), now=NOW)
        self.assertEqual(report["added"], 1)
        self.assertEqual(report["duplicateCount"], 1)
        self.assertEqual(len(self.read("public/data/configs.json")["configs"][0]["sources"]), 2)

    def test_partial_failure_and_invalid_records(self):
        self.sources([SOURCE, {**SOURCE, "id": "second"}])
        def fetch(source):
            if source["id"] == "second":
                raise FetchError("HTTP 404")
            return uri(1) + "\nvless://bad@example.com:443"
        report = run(self.root, fetcher=fetch, now=NOW)
        self.assertEqual(report["state"], "partial")
        self.assertEqual(report["invalidCount"], 1)
        self.assertEqual(report["added"], 1)
        self.assertEqual(report["sources"][1]["error"], "HTTP 404")

    def test_total_failure_retains_previous_data_and_timestamp(self):
        first = run(self.root, fetcher=lambda _: uri(1), now=NOW)
        def fail(_):
            raise FetchError("Network failure")
        report = run(self.root, fetcher=fail, now=NOW)
        self.assertEqual(report["state"], "failed")
        self.assertEqual(report["added"], 0)
        self.assertEqual(report["lastSuccessfulAt"], first["lastSuccessfulAt"])
        self.assertEqual(len(self.read("public/data/configs.json")["configs"]), 1)

    def test_invalid_manifest_is_reported_without_fetching(self):
        self.sources([{**SOURCE, "path": "../../etc/passwd"}])
        fetch = Mock()
        status = run(self.root, fetcher=fetch, now=NOW)
        self.assertEqual(status["state"], "failed")
        self.assertTrue(status["errors"])
        fetch.assert_not_called()

    def test_corrupt_registry_is_not_overwritten(self):
        write_json(self.root / "data/seen.json", ["invalid"])
        with self.assertRaises(ValueError):
            run(self.root, fetcher=lambda _: uri(1), now=NOW)
        self.assertEqual(self.read("data/seen.json"), ["invalid"])

    def test_limit_is_hard_capped(self):
        for limit in (0, 51, -1, True):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                run(self.root, limit=limit)

    def test_snapshot_bound_does_not_erase_archive_or_seen_registry(self):
        # Twenty-one real pipeline batches exercise the 1,000-record window.
        for batch in range(21):
            run(self.root, fetcher=lambda _, b=batch: "\n".join(uri(n) for n in range(b * 50, b * 50 + 50)), now=NOW)
        self.assertEqual(len(self.read("public/data/configs.json")["configs"]), 1000)
        self.assertEqual(len(self.read("data/archive/2026-10.json")), 1050)
        self.assertEqual(run(self.root, fetcher=lambda _: uri(0), now=NOW)["added"], 0)

    def test_history_window_and_monthly_archives(self):
        run(self.root, fetcher=lambda _: uri(1), now=NOW)
        later = datetime(2026, 11, 1, tzinfo=timezone.utc)
        run(self.root, fetcher=lambda _: uri(2), now=later)
        self.assertEqual(len(self.read("data/archive/2026-10.json")), 1)
        self.assertEqual(len(self.read("data/archive/2026-11.json")), 1)
        history = self.read("public/data/history.json")
        write_json(self.root / "public/data/history.json", history * 60)
        run(self.root, fetcher=lambda _: "", now=later)
        self.assertEqual(len(self.read("public/data/history.json")), 120)

    def test_path_and_host_injection_rejected(self):
        for field, value in [("owner", "evil.com/"), ("repo", "../private"), ("ref", "main?url=http://localhost"), ("path", "http://127.0.0.1"), ("path", "%2e%2e/secret"), ("path", "/etc/passwd"), ("path", "file/../secret"), ("path", "file?token=bad")]:
            self.sources([{**SOURCE, field: value}])
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                load_sources(self.root / "sources.json")

    def test_redirects_including_private_network_are_never_followed(self):
        for destination in ("http://127.0.0.1/secret", "https://example.com/redirect", "file:///etc/passwd"):
            with self.subTest(destination=destination), self.assertRaises(FetchError):
                NoRedirects().redirect_request(Request("https://raw.githubusercontent.com/a/b/main/x"), None, 302, "Redirect", {}, destination)

    @patch("collector.pipeline.build_opener")
    def test_fetch_is_bounded_and_ignores_injected_fetch_url(self, opener):
        response = Mock(status=200, headers={})
        response.read1.side_effect = [b"config", b""]
        opener.return_value.open.return_value.__enter__ = Mock(return_value=response)
        opener.return_value.open.return_value.__exit__ = Mock(return_value=False)
        self.assertEqual(fetch_source({**SOURCE, "fetchUrl": "http://127.0.0.1/secret"}), "config")
        args, kwargs = opener.return_value.open.call_args
        self.assertEqual(args[0].full_url, "https://raw.githubusercontent.com/example/public-configs/main/configs/list.txt")
        self.assertEqual(kwargs["timeout"], 20)
        response.read1.assert_any_call(65536)
        response.read1.side_effect = [b"a" * 65536] * (MAX_SOURCE_BYTES // 65536) + [b"a"]
        with self.assertRaises(FetchError):
            fetch_source(SOURCE)

    @patch("collector.pipeline.time.monotonic", side_effect=[0, 31])
    @patch("collector.pipeline.build_opener")
    def test_total_fetch_time_budget_is_enforced(self, opener, clock):
        response = Mock(status=200, headers={})
        opener.return_value.open.return_value.__enter__ = Mock(return_value=response)
        opener.return_value.open.return_value.__exit__ = Mock(return_value=False)
        with self.assertRaises(FetchError):
            fetch_source(SOURCE)
        response.read1.assert_not_called()

    @patch("collector.pipeline.build_opener")
    def test_tls_errors_do_not_disable_verification_or_retry_other_hosts(self, opener):
        opener.return_value.open.side_effect = URLError("TLS verification failed")
        with self.assertRaises(FetchError):
            fetch_source(SOURCE)
        self.assertEqual(opener.return_value.open.call_count, 1)


if __name__ == "__main__":
    unittest.main()

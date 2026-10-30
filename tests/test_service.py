import copy
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from collector.pipeline import load_json, write_json
from collector.protocols import parse_config
from collector.service import ServiceFailure, run_service, service_origin

ORIGIN = "https://nil-config-catcher-babakyaghoobii.higgsfield.app"
SOURCE = {"id": "test", "name": "Public fixture", "url": "https://github.com/example/public/blob/main/list.txt"}


def record(number, month="10"):
    return {**parse_config(f"trojan://fixture-{number}@example.com:443#Fixture"),
            "firstSeenAt": f"2026-{month}-28T12:00:00Z", "sources": [SOURCE]}


def batch(rows, added=1, dataset="dataset-one"):
    status = {"schemaVersion": 1, "state": "success", "startedAt": "2026-10-30T12:00:00Z",
              "finishedAt": "2026-10-30T12:00:01Z", "lastSuccessfulAt": "2026-10-30T12:00:00Z",
              "added": added, "target": 50, "totalUnique": len(rows), "duplicateCount": 0,
              "invalidCount": 0, "scheduleHours": 2, "snapshotLimit": 1000,
              "sources": [], "errors": [], "connectionTested": False}
    return {"snapshot": {"schemaVersion": 1, "generatedAt": status["finishedAt"], "totalUnique": len(rows), "configs": rows[-1000:]},
            "status": status, "history": [status], "checkpoint": len(rows), "datasetId": dataset}


class ServiceArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        write_json(self.root / "deployment.json", {"serviceOrigin": ORIGIN})
        self.rows = [record(1, "09"), record(2)]
        self.value = batch(self.rows)
        self.calls = []

    def tearDown(self):
        self.tmp.cleanup()

    def read(self, name, default=None):
        return load_json(self.root / name, default)

    def transport(self, origin, endpoint, body):
        self.assertEqual(origin, ORIGIN)
        self.calls.append((endpoint, body))
        if endpoint in ("/api/collect", "/api/sync"):
            return copy.deepcopy(self.value)
        params = parse_qs(urlsplit(endpoint).query)
        cursor, until = int(params["cursor"][0]), int(params["until"][0])
        # Tiny real pages verify traversal independently of the requested page size.
        next_cursor = min(until, cursor + 1)
        return {"records": copy.deepcopy(self.rows[cursor:next_cursor]), "cursor": next_cursor,
                "until": until, "done": next_cursor == until, "datasetId": self.value["datasetId"]}

    def test_archives_manual_and_scheduled_records_with_original_months(self):
        status = run_service(self.root, transport=self.transport)
        self.assertEqual(status["added"], 1)  # Not falsely reported as two added by this run.
        self.assertEqual(len(self.read("data/seen.json")), 2)
        self.assertEqual(self.read("data/archive/2026-09.json")[0], self.rows[0])
        self.assertEqual(self.read("data/archive/2026-10.json")[0], self.rows[1])
        self.assertEqual(self.read("public/server-sync.json", {}), {})
        self.assertEqual(self.read("public/data/server-sync.json")["cursor"], 2)

    def test_repeated_import_is_idempotent_and_new_profile_is_archived_once(self):
        run_service(self.root, transport=self.transport)
        run_service(self.root, transport=self.transport)
        self.rows.append(record(3))
        self.value = batch(self.rows)
        run_service(self.root, transport=self.transport)
        self.assertEqual(len(self.read("data/seen.json")), 3)
        self.assertEqual(len(self.read("data/archive/2026-10.json")), 2)

    def test_new_dataset_resets_export_cursor_without_erasing_dedup_registry(self):
        run_service(self.root, transport=self.transport)
        self.value = batch(self.rows, added=0, dataset="replacement-dataset")
        self.calls.clear()
        status = run_service(self.root, transport=self.transport)
        self.assertEqual(status["state"], "success")
        self.assertIn("cursor=0", self.calls[2][0])
        self.assertEqual(len(self.read("data/archive/2026-10.json")), 1)

    def test_corrupt_uri_hash_does_not_advance_cursor_or_modify_snapshot(self):
        run_service(self.root, transport=self.transport)
        before = (self.root / "public/data/configs.json").read_bytes()
        self.rows.append(record(3))
        self.value = batch(self.rows)
        self.rows[2]["id"] = "0" * 64
        report = run_service(self.root, transport=self.transport)
        self.assertEqual(report["state"], "failed")
        self.assertEqual((self.root / "public/data/configs.json").read_bytes(), before)
        self.assertEqual(self.read("public/data/server-sync.json")["cursor"], 2)
        self.assertEqual(len(self.read("data/seen.json")), 2)

    def test_service_outage_retains_data_and_never_falls_back_to_independent_fetch(self):
        run_service(self.root, transport=self.transport)
        def fail(*args):
            raise ServiceFailure("TLS failure")
        report = run_service(self.root, transport=fail)
        self.assertEqual(report["state"], "failed")
        self.assertEqual(report["added"], 0)
        self.assertEqual(len(self.read("data/seen.json")), 2)
        self.assertEqual(report["lastSuccessfulAt"], self.value["status"]["lastSuccessfulAt"])

    def test_rate_limit_is_retried_with_bounded_server_delay(self):
        retries = []
        def busy(origin, endpoint, body):
            if endpoint == "/api/collect" and not retries:
                retries.append(True)
                raise ServiceFailure("Busy", 429, 600)
            return self.transport(origin, endpoint, body)
        pauses = []
        report = run_service(self.root, transport=busy, pause=pauses.append)
        self.assertEqual(report["state"], "success")
        self.assertEqual(pauses, [90])

    def test_incomplete_export_or_missing_registry_ids_are_rejected(self):
        self.value["snapshot"]["totalUnique"] = 3
        self.value["status"]["totalUnique"] = 3
        status = run_service(self.root, transport=self.transport)
        self.assertEqual(status["state"], "failed")
        self.assertIsNone(self.read("data/seen.json"))

    def test_service_origin_cannot_redirect_collection_to_arbitrary_hosts(self):
        for invalid in ("http://" + urlsplit(ORIGIN).netloc, ORIGIN + "/", ORIGIN + ":443", ORIGIN + "@127.0.0.1", "https://127.0.0.1", "https://example.com"):
            write_json(self.root / "deployment.json", {"serviceOrigin": invalid})
            with self.assertRaises(ValueError):
                service_origin(self.root)

    def test_untrusted_batch_shapes_produce_failure_instead_of_writing_fake_data(self):
        for invalid in (None, [], {"snapshot": []}):
            report = run_service(self.root, transport=lambda *args: invalid)
            self.assertEqual(report["state"], "failed")
            self.assertIsNone(self.read("public/data/configs.json"))


if __name__ == "__main__":
    unittest.main()

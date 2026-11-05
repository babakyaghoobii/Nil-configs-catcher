import base64
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import Mock, patch

from collector.pipeline import load_json, write_json
from collector.protocols import parse_config

ROOT = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / "scripts" / (name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


prepare_module = module("prepare-cloudflare")
verify_module = module("verify-cloudflare")
DATABASE_ID = "01234567-89ab-cdef-0123-456789abcdef"
ORIGIN = "https://nil-config-catcher.nil-tests.workers.dev"


class CloudflareDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.calls = []
        self.worker_exists = False
        self.worker_owned = False
        self.database_exists = False
        self.tables = []

    def tearDown(self):
        self.tmp.cleanup()

    def api(self, path, payload=None, method=None):
        self.calls.append((path, payload, method))
        if path == "/workers/subdomain":
            return {"subdomain": "nil-tests"}
        if path.endswith("/settings"):
            if not self.worker_exists:
                raise prepare_module.CloudflareError("Missing", 404)
            return {"bindings": [{"name": "NIL_SOURCE_REPOSITORY", "type": "plain_text", "text": "babakyaghoobii/Nil-configs-catcher"}]} if self.worker_owned else {}
        database = {"name": prepare_module.DATABASE_NAME, "uuid": DATABASE_ID}
        if path.startswith("/d1/database?"):
            return [database] if self.database_exists else []
        if path == "/d1/database":
            return database
        if path.endswith("/query"):
            return [{"success": True, "results": [{"name": name} for name in self.tables]}]
        raise AssertionError("Unexpected API route " + path)

    def test_preparation_creates_only_named_resources_and_never_promotes_an_unverified_url(self):
        result = prepare_module.prepare(self.root, "a" * 32, self.api)
        config = load_json(self.root / "deploy/cloudflare.generated.json", {})
        self.assertEqual(result["serviceOrigin"], ORIGIN)
        self.assertEqual(config["d1_databases"][0]["database_id"], DATABASE_ID)
        self.assertEqual(config["assets"]["binding"], "ASSETS")
        self.assertNotIn("token", json.dumps(config).lower())
        self.assertFalse((self.root / "deployment.json").exists())

    def test_existing_unrelated_worker_is_never_replaced(self):
        self.worker_exists = True
        with self.assertRaisesRegex(ValueError, "refusing to replace"):
            prepare_module.prepare(self.root, "a" * 32, self.api)
        self.assertFalse(any(path == "/d1/database" for path, _, _ in self.calls))

    def test_existing_own_worker_and_database_are_reused(self):
        self.worker_exists = self.database_exists = True
        write_json(self.root / "deployment.json", {"serviceOrigin": ORIGIN, "sourceRepository": "babakyaghoobii/Nil-configs-catcher", "databaseId": DATABASE_ID})
        prepare_module.prepare(self.root, "a" * 32, self.api)
        self.assertFalse(any(path == "/d1/database" for path, _, _ in self.calls))

    def test_partial_first_deployment_can_retry_only_with_its_public_ownership_marker(self):
        self.worker_exists = self.worker_owned = self.database_exists = True
        self.tables = ["nil_seen", "nil_configs", "d1_migrations", "sqlite_sequence"]
        result = prepare_module.prepare(self.root, "a" * 32, self.api)
        self.assertEqual(result["databaseId"], DATABASE_ID)
        self.assertFalse((self.root / "deployment.json").exists())

    def test_database_with_unrelated_tables_is_not_modified(self):
        self.database_exists = True
        self.tables = ["private_customer_records"]
        with self.assertRaisesRegex(ValueError, "unrelated tables"):
            prepare_module.prepare(self.root, "a" * 32, self.api)
        self.assertFalse((self.root / "deployment.candidate.json").exists())

    def test_api_errors_never_include_authorization_or_raw_response_bodies(self):
        token = "TEST-TOKEN-DO-NOT-LOG"
        opener = Mock()
        opener.open.side_effect = HTTPError("https://api.cloudflare.com", 403, token, {}, None)
        with patch.object(prepare_module, "build_opener", return_value=opener):
            client = prepare_module.api_client("a" * 32, token)
            with self.assertRaises(prepare_module.CloudflareError) as error:
                client("/workers/subdomain")
        self.assertNotIn(token, str(error.exception))
        self.assertEqual(error.exception.status, 403)

    def test_api_client_rejects_invalid_account_and_unrelated_routes_before_network(self):
        with self.assertRaises(ValueError):
            prepare_module.api_client("https://127.0.0.1", "fixture-token")
        client = prepare_module.api_client("a" * 32, "fixture-token")
        with self.assertRaises(ValueError):
            client("https://example.com")

    def verification_fixture(self):
        write_json(self.root / "deployment.candidate.json", {"serviceOrigin": ORIGIN, "provider": "cloudflare", "databaseId": DATABASE_ID, "sourceRepository": "babakyaghoobii/Nil-configs-catcher"})
        html = self.root / "dist-hosted/index.html"
        html.parent.mkdir(parents=True, exist_ok=True)
        html.write_bytes(b"<html>NIL fixture</html>")
        icon = self.root / "dist-hosted/icons/icon-192.png"
        icon.parent.mkdir()
        icon.write_bytes(b"fixture-icon")
        record = {**parse_config("trojan://fixture@example.com:443"), "firstSeenAt": "2026-01-01T00:00:00Z", "sources": [{"id": "fixture", "name": "Fixture", "url": "https://github.com/example/public/blob/main/list.txt"}]}
        report = {"schemaVersion": 1, "state": "success", "startedAt": record["firstSeenAt"], "finishedAt": record["firstSeenAt"], "totalUnique": 1, "added": 1, "duplicateCount": 0, "invalidCount": 0, "connectionTested": False}
        values = {"/": html.read_bytes(), "/icons/icon-192.png": icon.read_bytes(), "/manifest.webmanifest": json.dumps({"short_name": "NIL", "display": "standalone"}).encode(), "/api/sync": b"{}", "/api/collect": json.dumps({"snapshot": {"totalUnique": 1, "configs": [record]}, "status": report}).encode(), "/api/subscription?protocol=all&source=all&format=base64": base64.b64encode((record["uri"] + "\n").encode())}
        def fetcher(origin, path, payload=None):
            self.assertEqual(origin, ORIGIN)
            return values[path], {"profile-update-interval": "2"}
        return values, fetcher

    def test_only_matching_live_html_real_parsed_records_and_feed_promote_the_deployment(self):
        _, fetcher = self.verification_fixture()
        report = verify_module.verify(self.root, fetcher)
        self.assertEqual(report["subscriptionConfigs"], 1)
        self.assertEqual(load_json(self.root / "deployment.json", {})["serviceOrigin"], ORIGIN)
        self.assertTrue(report["verifiedAt"].endswith("Z"))

    def test_failed_html_or_subscription_verification_never_promotes_the_url(self):
        for path in ("/", "/api/subscription?protocol=all&source=all&format=base64"):
            values, fetcher = self.verification_fixture()
            values[path] = b"not the application or subscription"
            with self.assertRaises(ValueError):
                verify_module.verify(self.root, fetcher)
            self.assertFalse((self.root / "deployment.json").exists())
            # Recreate only fixture assets for the next scenario.
            (self.root / "dist-hosted/icons/icon-192.png").unlink()
            (self.root / "dist-hosted/icons").rmdir()


if __name__ == "__main__":
    unittest.main()

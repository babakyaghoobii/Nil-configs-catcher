"""Generate a non-secret deployment config from the owner's scoped CI credentials."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector.pipeline import NoRedirects, load_json, write_json

WORKER_NAME = "nil-config-catcher"
DATABASE_NAME = "nil-config-catcher-babakyaghoobii"
SOURCE_REPOSITORY = "babakyaghoobii/Nil-configs-catcher"
ROOT = Path(__file__).resolve().parents[1]


class CloudflareError(ValueError):
    def __init__(self, message, status=0):
        super().__init__(message)
        self.status = status


def api_client(account, token):
    if not re.fullmatch(r"[a-f0-9]{32}", account or "") or not token or any(c.isspace() for c in token):
        raise ValueError("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in GitHub repository Actions secrets")

    def call(path, payload=None, method=None):
        # Only fixed account-local API routes constructed below are accepted.
        if not path.startswith(("/workers/", "/d1/")) or any(x in path for x in ("..", "#", "\\")):
            raise ValueError("Invalid Cloudflare API route")
        data = json.dumps(payload).encode() if payload is not None else None
        request = Request("https://api.cloudflare.com/client/v4/accounts/" + account + path,
                          data=data, method=method or ("POST" if data is not None else "GET"),
                          headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": "NIL-Deploy/1.0"})
        try:
            with build_opener(NoRedirects()).open(request, timeout=30) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise CloudflareError("Cloudflare API response exceeded its limit")
            value = json.loads(raw)
            if not isinstance(value, dict) or value.get("success") is not True:
                raise CloudflareError("Cloudflare rejected the operation; check the scoped token permissions")
            return value.get("result")
        except HTTPError as error:
            # Never log a request, Authorization header, token, or raw API body.
            raise CloudflareError(f"Cloudflare HTTP {error.code}; check the selected account and token permissions", error.code) from None
        except (URLError, TimeoutError, OSError, UnicodeError) as error:
            raise CloudflareError("Cloudflare network, TLS or timeout failure") from None
    return call


def prepare(root, account, api):
    try:
        subdomain = api("/workers/subdomain")
    except CloudflareError as error:
        if error.status != 404:
            raise
        subdomain = None
    name = subdomain.get("subdomain") if isinstance(subdomain, dict) else None
    if not name:
        name = "nil-" + hashlib.sha256(account.encode()).hexdigest()[:12]
        api("/workers/subdomain", {"subdomain": name}, "PUT")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", name):
        raise ValueError("Cloudflare returned an invalid workers.dev subdomain")
    origin = f"https://{WORKER_NAME}.{name}.workers.dev"
    try:
        settings = api(f"/workers/scripts/{WORKER_NAME}/settings")
        exists = True
    except CloudflareError as error:
        if error.status != 404:
            raise
        exists = False
        settings = {}
    previous = load_json(root / "deployment.json", {})
    owned = isinstance(settings, dict) and any(
        isinstance(binding, dict) and binding.get("name") == "NIL_SOURCE_REPOSITORY"
        and binding.get("type") == "plain_text" and binding.get("text") == SOURCE_REPOSITORY
        for binding in settings.get("bindings", [])
    )
    if exists and not owned and (previous.get("serviceOrigin") != origin or previous.get("sourceRepository") != SOURCE_REPOSITORY):
        raise ValueError("A Worker with this name already exists without NIL deployment provenance; refusing to replace it")
    rows = api("/d1/database?name=" + DATABASE_NAME + "&per_page=100")
    if not isinstance(rows, list):
        raise ValueError("Invalid Cloudflare database listing")
    matches = [row for row in rows if isinstance(row, dict) and row.get("name") == DATABASE_NAME]
    if len(matches) > 1:
        raise ValueError("Multiple NIL databases found; refusing an ambiguous deployment")
    database = matches[0] if matches else api("/d1/database", {"name": DATABASE_NAME})
    identifier = database.get("uuid") if isinstance(database, dict) else None
    if not isinstance(identifier, str) or not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", identifier):
        raise ValueError("Cloudflare returned an invalid database identifier")
    if matches and previous.get("databaseId") != identifier:
        schema = api(f"/d1/database/{identifier}/query", {"sql": "SELECT name FROM sqlite_master WHERE type='table'"})
        allowed = {"nil_seen", "nil_totals", "nil_configs", "nil_runs", "nil_state", "nil_locks", "d1_migrations", "sqlite_sequence"}
        if not isinstance(schema, list) or not all(isinstance(result, dict) and result.get("success") is True for result in schema):
            raise ValueError("Cannot verify the existing database schema")
        names = [row.get("name", "") for result in schema for row in result.get("results", [])]
        if any(table not in allowed and not table.startswith("_cf_") for table in names):
            raise ValueError("The named database contains unrelated tables; refusing to modify it")
    config = {
        "$schema": "../node_modules/wrangler/config-schema.json", "name": WORKER_NAME,
        "main": "../service/worker.ts", "compatibility_date": "2026-10-30", "workers_dev": True,
        "vars": {"NIL_SOURCE_REPOSITORY": SOURCE_REPOSITORY},
        "assets": {"directory": "../dist-hosted", "binding": "ASSETS", "run_worker_first": True,
                   "html_handling": "auto-trailing-slash", "not_found_handling": "none"},
        "d1_databases": [{"binding": "DB", "database_name": DATABASE_NAME, "database_id": identifier,
                          "migrations_dir": "../service/migrations"}],
        "observability": {"enabled": True},
    }
    write_json(root / "deploy" / "cloudflare.generated.json", config)
    candidate = {"serviceOrigin": origin, "databaseId": identifier,
                 "sourceRepository": SOURCE_REPOSITORY, "provider": "cloudflare"}
    write_json(root / "deployment.candidate.json", candidate)
    return candidate


def main():
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    try:
        result = prepare(ROOT, account, api_client(account, token))
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise SystemExit(str(error))
    print(json.dumps({"state": "prepared-not-deployed", "serviceOrigin": result["serviceOrigin"]}))


if __name__ == "__main__":
    main()

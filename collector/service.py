"""Archive the authoritative service's real public records; never split dedup state."""

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener

from .pipeline import FetchError, HISTORY_LIMIT, NoRedirects, load_json, write_json
from .protocols import parse_config

MAX_RESPONSE = 6 * 1024 * 1024
IDENTIFIER = re.compile(r"[a-f0-9]{64}\Z")
SOURCE_URL = re.compile(r"https://github\.com/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}/blob/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9_./-]{1,500}\Z")


class ServiceFailure(FetchError):
    def __init__(self, message, code=503, retry=0):
        super().__init__(message)
        self.code, self.retry = code, retry


def service_origin(root: Path) -> str:
    config = load_json(root / "deployment.json", None)
    origin = config.get("serviceOrigin") if isinstance(config, dict) else None
    if not isinstance(origin, str):
        raise ValueError("deployment.json must contain a verified serviceOrigin")
    parsed = urlsplit(origin)
    allowed = {
        "nil-config-catcher-babakyaghoobii.higgsfield.app",
        "nil-config-catcher-babakyaghoobii.lovable.app",
    }
    if parsed.scheme != "https" or parsed.netloc not in allowed or parsed.path or parsed.query or parsed.fragment:
        raise ValueError("Only the checked-in NIL HTTPS service origin is permitted")
    return origin


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def request_json(origin: str, endpoint: str, body=None):
    # Callers supply only these fixed routes, never an untrusted URL or config URI.
    path = urlsplit(endpoint)
    if path.path not in ("/api/sync", "/api/collect", "/api/export") or path.scheme or path.netloc or path.fragment:
        raise ValueError("Invalid service route")
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json", "Accept-Encoding": "identity", "User-Agent": "NIL-Archive/1.1"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    try:
        deadline = time.monotonic() + 75
        with build_opener(NoRedirects()).open(Request(origin + endpoint, data=data, headers=headers), timeout=45) as response:
            if response.status != 200 or response.headers.get("Content-Encoding", "identity") not in ("", "identity"):
                raise ServiceFailure("Unexpected service response")
            raw = bytearray()
            while True:
                if time.monotonic() > deadline:
                    raise ServiceFailure("Service response timed out")
                part = response.read1(min(65536, MAX_RESPONSE + 1 - len(raw)))
                if not part:
                    break
                raw.extend(part)
                if len(raw) > MAX_RESPONSE:
                    raise ServiceFailure("Service response exceeds limit")
        return json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=_object,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Invalid JSON number")))
    except HTTPError as error:
        try:
            retry = min(90, max(1, int(error.headers.get("Retry-After", "3"))))
        except (TypeError, ValueError):
            retry = 3
        raise ServiceFailure(f"Service HTTP {error.code}", error.code, retry) from error
    except (URLError, TimeoutError, OSError, UnicodeError) as error:
        raise ServiceFailure("Service network, TLS or encoding error") from error


def _timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("Invalid record timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp requires a timezone")
    return parsed.astimezone(timezone.utc)


def _integer(value, maximum=100_000_000):
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError("Invalid service count")
    return value


def _record(record):
    if not isinstance(record, dict):
        raise ValueError("Invalid record")
    parsed = parse_config(record.get("uri"))
    if any(record.get(key) != parsed[key] for key in ("id", "protocol", "host", "port")):
        raise ValueError("Record does not match its parsed URI")
    _timestamp(record.get("firstSeenAt"))
    sources = record.get("sources")
    if not isinstance(sources, list) or not 1 <= len(sources) <= 20:
        raise ValueError("Record has no public provenance")
    for source in sources:
        if not isinstance(source, dict) or not isinstance(source.get("url"), str) or not SOURCE_URL.fullmatch(source["url"]):
            raise ValueError("Invalid public source URL")
        if any(part in (".", "..") for part in urlsplit(source["url"]).path.split("/")):
            raise ValueError("Unsafe source path")
        if not isinstance(source.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}", source["id"]):
            raise ValueError("Invalid source identity")
        if not isinstance(source.get("name"), str) or not 1 <= len(source["name"]) <= 80:
            raise ValueError("Invalid source name")
    return record


def _report(report, total=None):
    if not isinstance(report, dict) or report.get("schemaVersion") != 1 or report.get("state") not in ("success", "partial", "failed") or report.get("connectionTested") is not False:
        raise ValueError("Invalid run report")
    for key in ("added", "totalUnique", "duplicateCount", "invalidCount"):
        _integer(report.get(key))
    if report["added"] > 50 or (total is not None and report["totalUnique"] != total):
        raise ValueError("Incoherent run report")
    for key in ("startedAt", "finishedAt"):
        _timestamp(report.get(key))
    return report


def run_service(root: Path, limit=50, transport=request_json, pause=time.sleep, now=None):
    if type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError("limit must be between 1 and 50")
    origin = service_origin(root)
    public = root / "public" / "data"
    registry = load_json(root / "data" / "seen.json", [])
    if not isinstance(registry, list) or any(not isinstance(item, str) or not IDENTIFIER.fullmatch(item) for item in registry) or len(set(registry)) != len(registry):
        raise ValueError("Invalid permanent registry; refusing to overwrite")
    history = load_json(public / "history.json", [])
    prior_status = load_json(public / "status.json", {})
    started = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    def call(endpoint, body=None):
        for attempt in range(4):
            try:
                return transport(origin, endpoint, body)
            except ServiceFailure as error:
                if error.code != 429 or attempt == 3:
                    raise
                pause(min(90, max(1, error.retry)))

    try:
        call("/api/sync", {})
        batch = call("/api/collect", {"limit": limit})
        if not isinstance(batch, dict) or not isinstance(batch.get("snapshot"), dict):
            raise ValueError("Invalid service batch")
        snapshot = batch["snapshot"]
        if snapshot.get("schemaVersion") != 1:
            raise ValueError("Invalid snapshot version")
        total = _integer(snapshot["totalUnique"])
        report = _report(batch["status"], total)
        if not isinstance(snapshot.get("configs"), list) or len(snapshot["configs"]) > 1000:
            raise ValueError("Invalid snapshot records")
        records = [_record(item) for item in snapshot["configs"]]
        if len({item["id"] for item in records}) != len(records):
            raise ValueError("Duplicate snapshot record")
        if snapshot.get("generatedAt") is not None:
            _timestamp(snapshot["generatedAt"])
        if not isinstance(batch.get("history"), list) or len(batch["history"]) > HISTORY_LIMIT:
            raise ValueError("Invalid service history")
        for entry in batch["history"]:
            _report(entry)
        dataset = batch.get("datasetId")
        if not isinstance(dataset, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", dataset):
            raise ValueError("Invalid dataset identity")
        until = _integer(batch["checkpoint"])
        marker = load_json(public / "server-sync.json", {})
        cursor = _integer(marker.get("cursor", 0)) if marker.get("datasetId") == dataset else 0
        if cursor > until:
            raise ValueError("Service checkpoint moved backwards")
        downloaded = {}
        for _ in range(1000):
            page = call("/api/export?" + urlencode({"cursor": cursor, "until": until, "limit": 100}))
            if not isinstance(page, dict):
                raise ValueError("Invalid export page")
            if page.get("datasetId") != dataset or page.get("until") != until or type(page.get("done")) is not bool:
                raise ValueError("Export changed dataset or range")
            next_cursor = _integer(page["cursor"])
            entries = page.get("records")
            if not isinstance(entries, list) or len(entries) > 100 or not cursor <= next_cursor <= until or (not page["done"] and next_cursor == cursor):
                raise ValueError("Invalid export progress")
            for item in entries:
                _record(item)
                if item["id"] in downloaded:
                    raise ValueError("Repeated export record")
                downloaded[item["id"]] = item
            cursor = next_cursor
            if page["done"]:
                # Sequence gaps are permitted, but a final nonempty page reaches until.
                if cursor != until:
                    raise ValueError("Incomplete export")
                break
        else:
            raise ValueError("Archive backlog exceeds bounded export budget")
        prior_seen = set(registry)
        seen = prior_seen | downloaded.keys()
        if len(seen) != total or any(item["id"] not in seen for item in records):
            raise ValueError("Permanent registry and server snapshot disagree")
        additions = [item for key, item in downloaded.items() if key not in prior_seen]
        by_month = {}
        for item in additions:
            month = _timestamp(item["firstSeenAt"]).strftime("%Y-%m")
            by_month.setdefault(month, []).append(item)
        # Validate all archive inputs before any write. Each file is atomically replaced;
        # the cursor is committed last and only a complete import advances it.
        archives = {}
        for month, items in by_month.items():
            path = root / "data" / "archive" / f"{month}.json"
            archive = load_json(path, [])
            archived = {item["id"] for item in archive}
            archives[path] = archive + [item for item in items if item["id"] not in archived]
        for path, archive in archives.items():
            write_json(path, archive)
        write_json(root / "data" / "seen.json", sorted(seen))
        write_json(public / "configs.json", snapshot)
        write_json(public / "history.json", batch["history"])
        write_json(public / "status.json", report)
        write_json(public / "server-sync.json", {"datasetId": dataset, "cursor": until})
        return report
    except (FetchError, ValueError, KeyError, TypeError, OSError) as error:
        # A configured-service outage must never launch a separate collector.
        report = {
            "schemaVersion": 1, "state": "failed", "startedAt": started,
            "finishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "lastSuccessfulAt": prior_status.get("lastSuccessfulAt"), "added": 0,
            "target": limit, "totalUnique": len(registry), "duplicateCount": 0,
            "invalidCount": 0, "scheduleHours": 2, "snapshotLimit": 1000,
            "sources": [], "errors": [f"Service archive failed: {str(error)[:160]}"],
            "connectionTested": False, "origin": "archive",
        }
        write_json(public / "status.json", report)
        write_json(public / "history.json", [report, *history][:HISTORY_LIMIT])
        return report

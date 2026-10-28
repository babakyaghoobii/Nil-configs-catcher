"""Bounded HTTPS collection, permanent deduplication, archives, and public snapshots."""

import itertools
import json
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .protocols import InvalidConfig, extract_candidates, parse_config

MAX_SOURCE_BYTES = 4 * 1024 * 1024
MAX_SOURCES = 20
SNAPSHOT_LIMIT = 1000
HISTORY_LIMIT = 120


class FetchError(ValueError):
    pass


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise FetchError("Redirects are not allowed")


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as temporary:
        try:
            json.dump(value, temporary, ensure_ascii=False, indent=2, allow_nan=False)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
            os.replace(temporary.name, path)
        finally:
            if os.path.exists(temporary.name):
                os.unlink(temporary.name)


def load_sources(path: Path) -> list[dict]:
    manifest = load_json(path, None)
    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        raise ValueError("sources.json must have version 1")
    sources = manifest.get("sources")
    if not isinstance(sources, list) or not 1 <= len(sources) <= MAX_SOURCES:
        raise ValueError("Configure between 1 and 20 sources")
    result, ids = [], set()
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("Invalid source")
        for key in ("id", "owner", "repo", "ref"):
            if not isinstance(source.get(key), str) or not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}", source[key]):
                raise ValueError("Invalid source " + key)
        if source["id"] in ids:
            raise ValueError("Duplicate source id")
        ids.add(source["id"])
        path_value = source.get("path", "")
        if not isinstance(path_value, str) or not 1 <= len(path_value) <= 500:
            raise ValueError("Invalid source path")
        if any(part in (".", "..") or not re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in path_value.split("/")):
            raise ValueError("Unsafe source path")
        if not isinstance(source.get("name"), str) or not 1 <= len(source["name"]) <= 80:
            raise ValueError("Invalid source name")
        if not isinstance(source.get("enabled", True), bool):
            raise ValueError("enabled must be a boolean")
        if source.get("enabled", True):
            relative = "/".join(source[key] for key in ("owner", "repo", "ref", "path"))
            result.append({**source, "fetchUrl": "https://raw.githubusercontent.com/" + relative,
                           "url": f"https://github.com/{source['owner']}/{source['repo']}/blob/{source['ref']}/{source['path']}"})
    if not result:
        raise ValueError("At least one source must be enabled")
    return result


def fetch_source(source: dict) -> str:
    # Only URLs reconstructed from a validated manifest are accepted. No user URLs,
    # redirects, endpoint probing, remote includes, shell commands, or dynamic code.
    checked = load_source_url(source)
    request = Request(checked, headers={"User-Agent": "NIL-Config-Catcher/1.0", "Accept": "text/plain", "Accept-Encoding": "identity"})
    try:
        deadline = time.monotonic() + 30
        with build_opener(NoRedirects()).open(request, timeout=20) as response:
            if response.status != 200:
                raise FetchError(f"HTTP {response.status}")
            if response.headers.get("Content-Encoding", "identity") not in ("", "identity"):
                raise FetchError("Compressed response is not allowed")
            data = bytearray()
            while True:
                if time.monotonic() > deadline:
                    raise FetchError("Source exceeded total time budget")
                # read1 performs at most one underlying read; a slow trickle
                # cannot indefinitely postpone the wall-clock budget check.
                chunk = response.read1(min(65536, MAX_SOURCE_BYTES + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > MAX_SOURCE_BYTES:
                    raise FetchError("Source exceeds 4 MiB limit")
            return data.decode("utf-8-sig", errors="strict")
    except HTTPError as exc:
        raise FetchError(f"HTTP {exc.code}") from exc
    except (URLError, TimeoutError, OSError, UnicodeError) as exc:
        raise FetchError("Network, TLS, timeout, or encoding error") from exc


def load_source_url(source: dict) -> str:
    # Revalidate even when fetch_source is used separately from the pipeline.
    raw = {key: source[key] for key in ("id", "name", "owner", "repo", "ref", "path")}
    for key in ("id", "owner", "repo", "ref"):
        if not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}", raw[key]):
            raise FetchError("Unsafe source identity")
    if any(part in (".", "..") or not re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in raw["path"].split("/")):
        raise FetchError("Unsafe source path")
    return "https://raw.githubusercontent.com/" + "/".join(raw[key] for key in ("owner", "repo", "ref", "path"))


def run(root: Path, limit=50, fetcher=fetch_source, now=None) -> dict:
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 50:
        raise ValueError("limit must be between 1 and 50")
    now = now or datetime.now(timezone.utc)
    timestamp = now.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    public = root / "public" / "data"
    previous = load_json(public / "configs.json", {"schemaVersion": 1, "generatedAt": None, "totalUnique": 0, "configs": []})
    seen_list = load_json(root / "data" / "seen.json", [])
    if not isinstance(seen_list, list) or any(not re.fullmatch(r"[0-9a-f]{64}", x) for x in seen_list):
        raise ValueError("Invalid deduplication registry; refusing to overwrite it")
    seen = set(seen_list)
    history = load_json(public / "history.json", [])
    prior_status = load_json(public / "status.json", {})
    reports, batches, errors = [], [], []
    try:
        sources = load_sources(root / "sources.json")
    except (ValueError, KeyError, TypeError) as exc:
        sources = []
        errors.append(str(exc))
    for source in sources:
        report = {"id": source["id"], "name": source["name"], "url": source["url"], "status": "success",
                  "candidates": 0, "valid": 0, "invalid": 0, "added": 0, "error": None}
        try:
            candidates = extract_candidates(fetcher(source))
            report["candidates"] = len(candidates)
            parsed = []
            for candidate in candidates:
                try:
                    parsed.append(parse_config(candidate))
                    report["valid"] += 1
                except InvalidConfig:
                    report["invalid"] += 1
            batches.append((source, parsed))
        except (FetchError, OSError, ValueError) as exc:
            report.update(status="failed", error=str(exc)[:160])
        reports.append(report)
    selected, duplicates, unselected = {}, 0, set()
    # Interleave sources so a large first source cannot monopolize the batch.
    rows = [[(source, item) for item in items] for source, items in batches]
    for row in itertools.zip_longest(*rows):
        for entry in row:
            if entry is None:
                continue
            source, item = entry
            source_ref = {"id": source["id"], "name": source["name"], "url": source["url"]}
            identifier = item["id"]
            if identifier in selected:
                duplicates += 1
                if source_ref not in selected[identifier]["sources"]:
                    selected[identifier]["sources"].append(source_ref)
            elif identifier in seen:
                duplicates += 1
            elif len(selected) < limit:
                selected[identifier] = {**item, "firstSeenAt": timestamp, "sources": [source_ref]}
                next(report for report in reports if report["id"] == source["id"])["added"] += 1
            else:
                unselected.add(identifier)
    new = list(selected.values())
    seen.update(selected)
    successful = sum(report["status"] == "success" for report in reports)
    state = "success" if reports and successful == len(reports) else ("partial" if successful else "failed")
    status = {
        "schemaVersion": 1, "state": state, "startedAt": timestamp,
        "finishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "lastSuccessfulAt": timestamp if successful else prior_status.get("lastSuccessfulAt"),
        "added": len(new), "target": limit, "totalUnique": len(seen), "duplicateCount": duplicates,
        "deferredUnique": len(unselected), "invalidCount": sum(r["invalid"] for r in reports),
        "scheduleHours": 2, "snapshotLimit": SNAPSHOT_LIMIT,
        "sources": reports, "errors": errors, "connectionTested": False,
    }
    if new:
        archive_path = root / "data" / "archive" / f"{now:%Y-%m}.json"
        archive = load_json(archive_path, [])
        archive_ids = {item["id"] for item in archive}
        write_json(archive_path, archive + [item for item in new if item["id"] not in archive_ids])
    snapshot = {"schemaVersion": 1, "generatedAt": timestamp if successful else previous.get("generatedAt"),
                "totalUnique": len(seen), "configs": (new + previous["configs"])[:SNAPSHOT_LIMIT]}
    # The single Actions writer commits these atomic files as one Git transaction.
    write_json(root / "data" / "seen.json", sorted(seen))
    write_json(public / "configs.json", snapshot)
    write_json(public / "history.json", ([status] + history)[:HISTORY_LIMIT])
    write_json(public / "status.json", status)
    return status

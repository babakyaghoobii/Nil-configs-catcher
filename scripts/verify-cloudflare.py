"""Promote only a public deployment whose actual HTML, API and feed were verified."""
import base64
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector.pipeline import NoRedirects, load_json, write_json
from collector.service import _record, _report, _object, validate_service_origin

ROOT = Path(__file__).resolve().parents[1]


def fetch_public(origin, path, payload=None):
    fixed = ("/", "/proxy/", "/proxy/apple-touch-icon.png", "/manifest.webmanifest", "/icons/icon-192.png",
             "/api/sync", "/api/collect", "/api/subscription?protocol=all&source=all&format=base64")
    if path not in fixed and not re.fullmatch(r"/api/(profile|latency)\?id=[a-f0-9]{64}", path):
        raise ValueError("Unexpected verification route")
    is_latency = path.startswith("/api/latency?")
    request = Request(origin + path, method="POST" if is_latency else None,
                      data=None if payload is None else json.dumps(payload).encode(),
                      headers={"Content-Type": "application/json", "Accept-Encoding": "identity", "User-Agent": "NIL-Public-Verification/1.0"})
    try:
        response = build_opener(NoRedirects()).open(request, timeout=45)
    except HTTPError as error:
        raise ValueError(f"{path.split('?')[0]} returned HTTP {error.code}") from None
    with response:
        raw = response.read(6 * 1024 * 1024 + 1)
        if response.status != 200 or len(raw) > 6 * 1024 * 1024 or response.headers.get("Content-Encoding", "identity") not in ("", "identity"):
            raise ValueError("Invalid public verification response")
        if response.headers.get("X-Content-Type-Options") != "nosniff":
            raise ValueError("The deployed Worker did not supply its security headers")
        return raw, response.headers


def verify(root, fetcher=fetch_public):
    candidate = load_json(root / "deployment.candidate.json", None)
    if not isinstance(candidate, dict) or candidate.get("provider") != "cloudflare" or candidate.get("sourceRepository") != "babakyaghoobii/Nil-configs-catcher":
        raise ValueError("No prepared Cloudflare deployment")
    origin = validate_service_origin(candidate.get("serviceOrigin"))
    html, _ = fetcher(origin, "/")
    if hashlib.sha256(html).digest() != hashlib.sha256((root / "dist-hosted/index.html").read_bytes()).digest():
        raise ValueError("Live HTML does not match the built NIL application")
    icon, _ = fetcher(origin, "/icons/icon-192.png")
    if icon != (root / "dist-hosted/icons/icon-192.png").read_bytes():
        raise ValueError("Live icon does not match the creator's NIL logo")
    for route, asset in (("/proxy/", "index.html"), ("/proxy/apple-touch-icon.png", "apple-touch-icon.png")):
        if fetcher(origin, route)[0] != (root / "dist-hosted" / "proxy" / asset).read_bytes():
            raise ValueError("Live NIL Proxy HTML or icon does not match the build")
    manifest = json.loads(fetcher(origin, "/manifest.webmanifest")[0])
    if manifest.get("display") != "standalone" or manifest.get("short_name") != "NIL":
        raise ValueError("The live PWA manifest does not match NIL")
    fetcher(origin, "/api/sync", {})
    batch = json.loads(fetcher(origin, "/api/collect", {"limit": 50})[0], object_pairs_hook=_object)
    snapshot = batch["snapshot"]
    report = _report(batch["status"], snapshot["totalUnique"])
    if report["state"] == "failed":
        raise ValueError("The deployed collector could not fetch any public source")
    rows = [_record(row) for row in snapshot["configs"]]
    expected = {row["id"] for row in rows}
    if len(expected) != len(rows):
        raise ValueError("Duplicate live snapshot records")
    raw, headers = fetcher(origin, "/api/subscription?protocol=all&source=all&format=base64")
    uris = base64.b64decode(raw, validate=True).decode("utf-8", errors="strict").splitlines()
    from collector.protocols import parse_config
    ids = [parse_config(uri)["id"] for uri in uris]
    if len(set(ids)) != len(ids) or set(ids) != expected or headers.get("profile-update-interval") != "2":
        raise ValueError("The live subscription does not match the actual collected records")
    if rows:
        selected = rows[0]
        profile = fetcher(origin, "/api/profile?id=" + selected["id"])[0]
        if base64.b64decode(profile, validate=True).decode("utf-8") != selected["uri"] + "\n":
            raise ValueError("Live Connect profile does not match the selected config")
        latency = json.loads(fetcher(origin, "/api/latency?id=" + selected["id"])[0])
        state = latency.get("state")
        if state not in ("open", "failed", "unsupported") or (
            state == "open" and not (type(latency.get("latencyMs")) is int and 1 <= latency["latencyMs"] <= 6000)
        ):
            raise ValueError("Live TCP measurement endpoint did not return a valid result")
    candidate["verifiedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    write_json(root / "deployment.json", candidate)
    # Update the next desktop build's restrictive native CSP to the verified origin.
    native_path = root / "src-tauri/tauri.conf.json"
    native = load_json(native_path, None)
    if native:
        policy = native["app"]["security"]["csp"]
        sections = policy.split(";")
        for index, section in enumerate(sections):
            if section.strip().startswith("connect-src ") and origin not in section.split():
                sections[index] = section + " " + origin
        native["app"]["security"]["csp"] = ";".join(sections)
        write_json(native_path, native)
    return {"serviceOrigin": origin, "verifiedAt": candidate["verifiedAt"], "state": report["state"],
            "added": report["added"], "totalUnique": report["totalUnique"], "subscriptionConfigs": len(ids)}


if __name__ == "__main__":
    try:
        print(json.dumps(verify(ROOT)))
    except (ValueError, KeyError, TypeError, OSError, HTTPError, URLError) as error:
        raise SystemExit(f"Public deployment verification failed: {str(error)[:180]}")

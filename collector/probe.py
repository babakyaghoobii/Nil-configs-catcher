"""Measure HTTPS through supported public nodes, independently of collection."""

import argparse
import ipaddress
import os
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from .pipeline import load_json, write_json
from .protocols import InvalidConfig, parse_config

TARGET = "https://www.gstatic.com/generate_204"


def public_address(host, port):
    # Resolve once and pass a numeric address to the core to prevent DNS rebinding.
    addresses = [
        ipaddress.ip_address(entry[4][0])
        for entry in socket.getaddrinfo(host, port, family=socket.AF_INET, type=socket.SOCK_STREAM)
    ]
    if not addresses or any(
        not ip.is_global or ip.is_multicast or ip.is_reserved
        for ip in addresses
    ):
        raise ValueError("Non-public endpoint")
    return str(addresses[0])


def outbound(uri):
    parsed = parse_config(uri)
    if parsed["protocol"] != "vless":
        return None
    url = urlsplit(uri)
    pairs = parse_qsl(url.query, keep_blank_values=True)
    query = dict(pairs)
    if len(pairs) != len(query) or set(query) - {
        "type", "security", "encryption", "flow", "sni", "host", "path",
        "fp", "alpn", "headerType",
    }:
        return None
    transport = query.get("type", "tcp")
    flow = query.get("flow", "")
    if (
        query.get("security") != "tls"
        or query.get("encryption", "none") != "none"
        or query.get("headerType", "none") != "none"
        or transport not in ("tcp", "raw", "ws")
        or flow not in ("", "xtls-rprx-vision")
        or (transport == "ws" and flow)
        or not re.fullmatch(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", url.username or "")
    ):
        return None
    sni = query.get("sni") or parsed["host"]
    host = query.get("host") or sni
    if not all(re.fullmatch(r"[A-Za-z0-9.:-]{1,253}", name) for name in (sni, host)):
        return None
    stream = {"network": "ws" if transport == "ws" else "raw", "security": "tls",
              "tlsSettings": {"serverName": sni, "minVersion": "1.2"}}
    for key in ("fp", "alpn"):
        if query.get(key):
            stream["tlsSettings"]["fingerprint" if key == "fp" else key] = (
                query[key] if key == "fp" else query[key].split(",")
            )
    if transport == "ws":
        path = query.get("path") or "/"
        if not re.fullmatch(r"/(?!/)[^\x00-\x20\x7f]*", path):
            return None
        stream["wsSettings"] = {"path": path, "host": host}
    return {"protocol": "vless", "settings": {
        "address": parsed["host"], "port": parsed["port"], "id": url.username,
        "encryption": "none", "flow": flow,
    }, "streamSettings": stream}


def measure(config, core):
    endpoint = config["settings"]
    try:
        endpoint["address"] = public_address(endpoint["address"], endpoint["port"])
    except (OSError, ValueError):
        return {"state": "skipped"}
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        port = reserved.getsockname()[1]
    password = secrets.token_hex(16)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "probe.json"
        write_json(path, {
            "log": {"loglevel": "none"},
            "inbounds": [{"listen": "127.0.0.1", "port": port, "protocol": "socks",
                          "settings": {"auth": "password", "accounts": [
                              {"user": "nil", "pass": password}
                          ]}}],
            "outbounds": [config],
        })
        with subprocess.Popen([core, "run", "-c", str(path)], cwd=directory,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              env={"PATH": os.defpath}) as process:
            try:
                for _ in range(40):
                    if process.poll() is not None:
                        return {"state": "skipped"}
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                            break
                    except OSError:
                        time.sleep(0.05)
                else:
                    return {"state": "skipped"}
                response = subprocess.run([
                    "curl", "-q", "--silent", "--proxy", f"socks5h://127.0.0.1:{port}",
                    "--proxy-user", f"nil:{password}", "--noproxy", "",
                    "--connect-timeout", "6", "--max-time", "8", "--max-filesize", "16384",
                    "--output", os.devnull, "--write-out", "%{http_code} %{time_total}", TARGET,
                ], capture_output=True, text=True, timeout=10)
                code, _, seconds = response.stdout.partition(" ")
                if response.returncode == 0 and code == "204":
                    return {"state": "reachable", "latencyMs": max(1, round(float(seconds) * 1000))}
                return {"state": "failed"}
            finally:
                process.kill()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--core", default="xray")
    parser.add_argument("--limit", type=int, choices=range(1, 101), default=60)
    args = parser.parse_args()
    core = shutil.which(args.core)
    if not core or not shutil.which("curl"):
        parser.error("Xray and curl are required")
    core = str(Path(core).resolve())
    data = args.root / "public" / "data"
    snapshot = load_json(data / "configs.json", {})
    candidates = {}
    for record in snapshot["configs"]:
        try:
            uri = record["uri"]
            if parse_config(uri)["id"] != record["id"]:
                continue
            config = outbound(uri)
        except (InvalidConfig, ValueError):
            continue
        if config:
            candidates[record["id"]] = config
        if len(candidates) == args.limit:
            break
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = dict(zip(candidates, pool.map(lambda config: measure(config, core), candidates.values())))
    write_json(data / "measurements.json", {
        "schemaVersion": 1,
        "measuredAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "results": results,
    })
    print({state: sum(result["state"] == state for result in results.values())
           for state in ("reachable", "failed", "skipped")})


if __name__ == "__main__":
    main()

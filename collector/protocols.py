"""Parse configuration URIs as data. Never resolve or connect to their endpoints."""

import base64
import binascii
import hashlib
import ipaddress
import json
import re
import uuid
from urllib.parse import parse_qsl, unquote, urlsplit

PROTOCOLS = ("vless", "vmess", "trojan", "ss", "hysteria2", "tuic")
MAX_URI_LENGTH = 16384
MAX_CANDIDATES = 20000
URI_RE = re.compile(r"(?:vless|vmess|trojan|ss|hysteria2|hy2|tuic)://[^\s<>\"'`]+", re.I)


class InvalidConfig(ValueError):
    pass


def decode_base64(value: str) -> bytes:
    if not value or len(value) > 6_000_000:
        raise InvalidConfig("Invalid base64 length")
    if not re.fullmatch(r"[A-Za-z0-9+/_-]*={0,2}", value):
        raise InvalidConfig("Invalid base64 alphabet")
    try:
        return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidConfig("Invalid base64") from exc


def extract_candidates(text: str) -> list[str]:
    """Support plaintext/Markdown and whole-file base64 subscriptions, bounded once."""
    if not URI_RE.search(text):
        try:
            text = decode_base64("".join(text.split())).decode("utf-8")
        except (InvalidConfig, UnicodeError):
            return []
    return [match.group(0) for _, match in zip(range(MAX_CANDIDATES), URI_RE.finditer(text))]


def strict_unquote(value: str) -> str:
    if re.search(r"%(?![0-9a-fA-F]{2})", value):
        raise InvalidConfig("Malformed percent encoding")
    try:
        result = unquote(value, errors="strict")
    except UnicodeError as exc:
        raise InvalidConfig("Invalid UTF-8") from exc
    if any(ord(c) < 32 or ord(c) == 127 for c in result):
        raise InvalidConfig("Control character")
    return result


def validate_host(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 253:
        raise InvalidConfig("Invalid host")
    try:
        return ipaddress.ip_address(value).compressed
    except ValueError:
        try:
            host = value.rstrip(".").encode("idna").decode("ascii").lower()
        except UnicodeError as exc:
            raise InvalidConfig("Invalid hostname") from exc
        if not host or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", part)
                           for part in host.split(".")):
            raise InvalidConfig("Invalid hostname")
        if re.fullmatch(r"[0-9.]+", host):
            raise InvalidConfig("Invalid IPv4 address")
        return host


def validate_port(value) -> int:
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]{1,5}", str(value)):
        raise InvalidConfig("Invalid port")
    port = int(value)
    if not 1 <= port <= 65535:
        raise InvalidConfig("Port out of range")
    return port


def validate_uuid(value: str) -> str:
    if not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", value):
        raise InvalidConfig("Invalid UUID")
    return str(uuid.UUID(value))


def unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidConfig("Duplicate JSON key")
        result[key] = value
    return result


def parse_config(uri: str) -> dict:
    if not isinstance(uri, str) or not uri or len(uri) > MAX_URI_LENGTH:
        raise InvalidConfig("Invalid URI length")
    if any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in uri) or "\\" in uri:
        raise InvalidConfig("Whitespace or unsafe separator in URI")
    try:
        return _parse_config(uri)
    except (ValueError, TypeError, KeyError, UnicodeError, OverflowError, RecursionError) as exc:
        if isinstance(exc, InvalidConfig):
            raise
        raise InvalidConfig("Malformed configuration") from exc


def _parse_config(uri: str) -> dict:
    protocol = uri.split("://", 1)[0].lower()
    protocol = "hysteria2" if protocol == "hy2" else protocol
    if protocol not in PROTOCOLS or "://" not in uri:
        raise InvalidConfig("Unsupported protocol")
    label = ""
    if protocol == "vmess":
        payload = uri.split("://", 1)[1].split("#", 1)[0]
        config = json.loads(decode_base64(payload).decode("utf-8"), object_pairs_hook=unique_json)
        if not isinstance(config, dict) or any(not isinstance(v, (str, int, bool)) for v in config.values()):
            raise InvalidConfig("Invalid VMess object")
        if any(isinstance(value, str) and any(ord(c) < 32 or ord(c) == 127 for c in value) for value in config.values()):
            raise InvalidConfig("Control character in VMess field")
        if "v" in config and str(config["v"]) != "2":
            raise InvalidConfig("Unsupported VMess version")
        host, port = validate_host(config["add"]), validate_port(config["port"])
        identifier = validate_uuid(config["id"])
        label = str(config.get("ps", ""))[:160]
        canonical = {k: v for k, v in config.items() if k != "ps"}
        canonical.update(add=host, port=port, id=identifier)
        if "aid" in canonical:
            if not str(canonical["aid"]).isdigit() or not 0 <= int(canonical["aid"]) <= 65535:
                raise InvalidConfig("Invalid alterId")
            canonical["aid"] = int(canonical["aid"])
    else:
        original = uri
        # Legacy Shadowsocks encodes the entire authority rather than user info.
        if protocol == "ss" and "@" not in uri.split("#", 1)[0]:
            authority = decode_base64(uri.split("://", 1)[1].split("#", 1)[0]).decode("utf-8")
            if any(ord(c) < 32 or ord(c) == 127 for c in authority):
                raise InvalidConfig("Control character in Shadowsocks authority")
            uri = "ss://" + authority + ("#" + uri.split("#", 1)[1] if "#" in uri else "")
        parts = urlsplit(uri)
        host = validate_host(parts.hostname or "")
        port = validate_port(parts.port if parts.port is not None else (443 if protocol == "hysteria2" else ""))
        if parts.path not in ("", "/") or "@" not in parts.netloc:
            raise InvalidConfig("Invalid authority or path")
        auth = strict_unquote(parts.netloc.rsplit("@", 1)[0])
        if not auth:
            raise InvalidConfig("Missing credentials")
        if protocol == "vless":
            auth = validate_uuid(auth)
        elif protocol == "tuic":
            identifier, separator, password = auth.partition(":")
            if not separator or not password:
                raise InvalidConfig("Missing TUIC password")
            auth = validate_uuid(identifier) + ":" + password
        elif protocol == "ss":
            if ":" not in auth:
                auth = decode_base64(auth).decode("utf-8")
            method, separator, password = auth.partition(":")
            if not separator or not password or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", method):
                raise InvalidConfig("Invalid Shadowsocks credentials")
        if any(ord(c) < 32 or ord(c) == 127 for c in auth):
            raise InvalidConfig("Control character in credentials")
        strict_unquote(parts.query)
        query = parse_qsl(parts.query, keep_blank_values=True, encoding="utf-8", errors="strict", max_num_fields=100)
        if len({key for key, _ in query}) != len(query):
            raise InvalidConfig("Duplicate query parameter")
        label = strict_unquote(parts.fragment)[:160]
        canonical = {"auth": auth, "host": host, "port": port, "query": sorted(query)}
        uri = original
    if any(ord(c) < 32 or ord(c) == 127 for c in label):
        raise InvalidConfig("Invalid label")
    normalized = protocol + ":" + json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return {
        "id": hashlib.sha256(normalized.encode()).hexdigest(),
        "uri": uri,
        "protocol": protocol,
        "name": label or host,
        "host": host,
        "port": port,
    }

"""Generate cross-language parser fixtures from the pinned Python reference.

Run with CPython 3.12 (the version the canonical GitHub Actions collector uses):

    python3.12 scripts/nil/gen_parser_fixtures.py [real-source.txt ...] > out.json

Each fixture records what reference/nil-python/collector/protocols.py returns
(id/protocol/name/host/port, or "invalid") so the TypeScript port can be
checked byte-for-byte. Real source files are optional; adversarial and
seeded-fuzz cases are always produced deterministically.
"""

import base64
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from collector.protocols import InvalidConfig, decode_base64, extract_candidates, parse_config  # noqa: E402

U = "12345678-1234-4321-8321-123456789abc"
UP = "12345678-1234-4321-8321-123456789ABC"


def b64(value, url=False, pad=False):
    if isinstance(value, dict):
        value = json.dumps(value)
    raw = value.encode("utf-8", "surrogatepass") if isinstance(value, str) else value
    out = (base64.urlsafe_b64encode if url else base64.b64encode)(raw).decode()
    return out if pad else out.rstrip("=")


def vm(obj_text):
    return "vmess://" + b64(obj_text)


def adversarial():
    v = [
        f"vless://{U}@example.com:443?security=tls#Test",
        f"vless://{UP}@EXAMPLE.com:443?type=ws&security=tls#One",
        f"vless://{U}@example.com:443?security=tls&type=ws#Two",
        f"VLESS://{U}@example.com:443",
        "trojan://secret@example.com:443?security=tls",
        "trojan://a@example.com:443", "trojan://b@example.com:443",
        "trojan://a@example.com:443?type=ws", "trojan://a@example.com:443?type=grpc",
        "ss://" + b64("aes-256-gcm:secret") + "@example.com:8388",
        "ss://" + b64("aes-256-gcm:secret@example.com:8388"),
        "ss://" + b64("aes-256-gcm:secret@example.com:8388") + "#legacy%20label",
        "ss://" + b64("aes-256-gcm:secret", url=True, pad=True) + "@example.com:8388",
        "ss://" + b64("chacha20-ietf-poly1305:p@ss") + "@example.com:8388",
        "ss://aes-256-gcm:secret@example.com:8388",
        "ss://aes-256-gcm:se%3Acret@example.com:8388",
        "ss://" + b64("bad:secret") + "@example.com:8388",
        "ss://" + b64("none:secret") + "@example.com:8388",
        "ss://" + b64("2022-blake3-aes-256-gcm:a2V5") + "@example.com:8388/?plugin=v2ray",
        "ss://" + b64("aes-256-gcm:pass\nword") + "@example.com:8388",
        "ss://" + b64("aes-256-gcm:pass@example.com:\n8388"),
        "ss://" + b64("aes-256-gcm:pass word@example.com:8388"),
        "ss://" + b64("aes-256-gcm:pw@[2001:db8::1]:8388"),
        "ss://" + b64("aes-256-gcm:pw@example.com:8388/path"),
        "ss://" + b64("aes-256-gcm:pw@example.com:8388?plugin=obfs"),
        "SS://" + b64("aes-256-gcm:pw@example.com:8388"),
        "hy2://secret@example.com:443?sni=example.com",
        "hysteria2://secret@example.com", "hy2://secret@example.com", "hysteria2://secret@example.com:443",
        "hysteria2://secret@example.com:", "trojan://secret@example.com:",
        f"tuic://{U}:secret@example.com:443?congestion_control=bbr",
        f"tuic://{U}:se:cret@example.com:443", f"tuic://{U}@example.com:443", f"tuic://{U}:@example.com:443",
        "trojan://secret@[2001:db8::1]:443", "trojan://secret@[2001:DB8:0:0:0:0:0:1]:443",
        "trojan://secret@[::ffff:1.2.3.4]:443", "trojan://secret@[::ffff:0102:0304]:443",
        "trojan://secret@[fe80::1%25Eth0]:443", "trojan://secret@[fe80::1%Eth0]:443",
        "trojan://secret@[1.2.3.4]:443", "trojan://secret@[v1.x]:443", "trojan://secret@[vz.x]:443",
        "trojan://secret@[::1]x:443", "trojan://secret@x[::1]:443", "trojan://secret@[::1:443",
        "trojan://secret@::1]:443", "trojan://p[x]@host:443", "trojan://p[x]@va.com:443",
        "trojan://p[x]@[::1]:443", "trojan://secret@[1:2:3:4:5:6:7:8]:443", "trojan://secret@[1:2:3:4:5:6:7:8:9]:443",
        "trojan://secret@[1::2::3]:443", "trojan://secret@[::]:443", "trojan://secret@[1:0:0:1:0:0:0:1]:443",
        "trojan://secret@[0:0:1::]:443", "trojan://secret@[:1:2:3:4:5:6:7]:443", "trojan://secret@[12345::]:443",
        "trojan://secret@[::1.2.3.04]:443", "trojan://secret@[" + "0:" * 20 + ":1]:443",
        "trojan://secret@1.2.3.4:443", "trojan://secret@01.2.3.4:443", "trojan://secret@1.2.3:443",
        "trojan://secret@256.1.1.1:443", "trojan://secret@999.999.999.999:443", "trojan://secret@1.2.3.4.:443",
        "trojan://secret@example.com.:443", "trojan://secret@example..com:443", "trojan://secret@-bad.example:443",
        "trojan://secret@bad-.example:443", "trojan://secret@" + "a" * 63 + ".com:443",
        "trojan://secret@" + "a" * 64 + ".com:443", "trojan://secret@" + ("a" * 60 + ".") * 4 + "com:443",
        "trojan://secret@xn--bcher-kva.example:443", "trojan://secret@b\u00fccher.example:443",
        "trojan://secret@\u212aexample.com:443", "trojan://secret@EXAMPLE.COM:443",
        "trojan://p\u2100@host:443", "trojan://p\uff1a@host:443", "trojan://\u0646\u06cc\u0644@example.com:443",
        "trojan://secret@example.com:0", "trojan://secret@example.com:65536", "trojan://secret@example.com:443.0",
        "trojan://secret@example.com:00443", "trojan://secret@example.com:" + "0" * 4296 + "443",
        "trojan://secret@example.com:" + "0" * 4298 + "443", "trojan://secret@example.com:+443",
        "trojan://secret@example.com:44:3", "trojan://secret@example.com:\u0664\u0664\u0663",
        "trojan://secret@example.com:443/remote", "trojan://secret@example.com:443/",
        "trojan://secret@example.com:443//", "trojan://secret@example.com:443/?a=1",
        "trojan://a%0Ab@example.com:443", "trojan://a%ZZ@example.com:443", "trojan://a%@example.com:443",
        "trojan://a%40b@example.com:443#%D9%86%DB%8C%D9%84", "trojan://a%D9@example.com:443",
        "trojan://a%D9\u0646%86@example.com:443", "trojan://%EF%BB%BFa@example.com:443",
        "trojan://a@b@example.com:443", "trojan://a:b@example.com:443", "trojan://@example.com:443",
        "trojan://a@example.com:443?a=1&a=2", "trojan://a@example.com:443?a=1&%61=2", "trojan://a@example.com:443?a&a=",
        "trojan://a@example.com:443?x=%ff", "trojan://a@example.com:443?x=%2B+y", "trojan://a@example.com:443?x=1&&y=2&",
        "trojan://a@example.com:443?b=2&a=1&c", "trojan://a@example.com:443?=v", "trojan://a@example.com:443?k==v",
        "trojan://a@example.com:443?" + "&".join(f"k{i}=v" for i in range(100)),
        "trojan://a@example.com:443?" + "&".join(f"k{i}=v" for i in range(101)),
        "trojan://a@example.com:443?" + "&" * 100, "trojan://a@example.com:443?x=%00",
        "trojan://a@example.com:443?\u00e9=\u00e8&e=1", "trojan://a@example.com:443?\U0001f600=1&\uffff=2",
        "trojan://a@example.com:443#bad label", "trojan://a@example.com:443#a%09b", "trojan://a@example.com:443#%",
        "trojan://a@example.com:443#" + "\u0646" * 200, "trojan://a@example.com:443#" + "\U0001f1ee\U0001f1f7" * 100,
        "trojan://a@example.com:443#a#b", "trojan://a@example.com:443#",
        "trojan://" + "a" * 17000 + "@example.com:443", "trojan://a@example.com\\evil:443",
        "trojan://a@example.com:443\u00a0", "trojan://a@exa\u2028mple.com:443", "trojan://a@example.com:443\x7f",
        "https://example.com/config", "trojan:/a@example.com:443", "trojan:a@example.com:443", "tuic:///x",
        "\u017fs://" + b64("aes-256-gcm:secret") + "@example.com:8388", "vle\u017fs://x@example.com:443",
        "vmess://%bad", vm("[]"), vm('{"id":"a","id":"b"}'), vm("null"), vm("{}"),
        vm({"v": "2", "add": "example.com", "port": "443", "id": U, "ps": "Test"}),
        vm({"add": "EXAMPLE.com", "port": "443", "id": U, "ps": "One", "aid": "0"}),
        vm({"aid": 0, "ps": "Two", "id": UP, "port": 443, "add": "example.com"}),
        vm({"add": "example.com", "port": 443, "id": 42}), vm({"add": "example.com", "port": True, "id": U}),
        vm({"add": "example.com", "port": "0443", "id": U}), vm({"add": "example.com", "port": 443.0, "id": U}),
        vm({"add": "example.com", "port": 443, "id": U, "v": 2}), vm({"add": "example.com", "port": 443, "id": U, "v": True}),
        vm({"add": "example.com", "port": 443, "id": U, "v": "1"}), vm({"add": "example.com", "port": 443, "id": U, "ps": 7}),
        vm({"add": "example.com", "port": 443, "id": U, "ps": False}), vm({"add": "example.com", "port": 443, "id": U, "ps": ""}),
        vm({"add": "example.com", "port": 443, "id": U, "ps": None}), vm({"add": "example.com", "port": 443, "id": U, "x": [1]}),
        vm({"add": "example.com", "port": 443, "id": U, "x": {}}), vm({"add": "example.com", "port": 443, "id": U, "aid": "\u0663"}),
        vm({"add": "example.com", "port": 443, "id": U, "aid": "\u00b2"}), vm({"add": "example.com", "port": 443, "id": U, "aid": "-1"}),
        vm({"add": "example.com", "port": 443, "id": U, "aid": "00012"}), vm({"add": "example.com", "port": 443, "id": U, "aid": 65536}),
        vm({"add": "example.com", "port": 443, "id": U, "aid": True}), vm({"add": "example.com", "port": 443, "id": U, "aid": "\U0001d7d7"}),
        vm({"add": "example.com", "port": 443, "id": U, "path": "/ws\n"}), vm({"add": "example.com", "port": 443, "id": U, "path": "/ws\x7f"}),
        vm({"add": "FE80::1%Eth0", "port": 443, "id": U}), vm({"add": "[::1]", "port": 443, "id": U}),
        vm({"add": "\u212aexample.com", "port": 443, "id": U}), vm({"add": "1.2.3.4", "port": 443, "id": U, "tls": "tls", "net": "ws"}),
        vm({"add": "example.com", "port": 443, "id": U, "\U0001f600": "a", "\uffff": "b", "Z": 1, "a": True}),
        vm({"add": "example.com", "port": 443, "id": U, "n": 10 ** 30}),
        vm('{"add":"example.com","port":443,"id":"' + U + '","n":' + "1" * 4301 + "}"),
        vm('{"add":"example.com","port":443,"id":"' + U + '","n":' + "1" * 4300 + "}"),
        vm('{"add":"example.com","port":443,"id":"' + U + '","n":NaN}'),
        vm('{"add":"example.com","port":443,"id":"' + U + '","n":-0}'),
        vm('{"add":"example.com","port":443,"id":"' + U + '","n":1e2}'),
        vm('{"add":"example.com","port":443,"id":"' + U + '","n":01}'),
        vm('{"add":"example.com","port":443,"id":"' + U + '","ps":"\\ud83d\\ude00 ok"}'),
        vm('{"add":"example.com","port":443,"id":"' + U + '","path":"\\ud800"}'),
        vm('{"add":"example.com","port":443,"id":"' + U + '","k\\u0000":"x"}'),
        vm('{"add":"example.com","port":443,"id":"' + U + '","q":"a\\"b\\\\c\\/"}'),
        vm(' \t\n{"add":"example.com","port":443,"id":"' + U + '"}\r\n'),
        vm('\ufeff{"add":"example.com","port":443,"id":"' + U + '"}'),
        vm('{"add":"example.com","port":443,"id":"' + U + '",}'),
        vm('{"add":"example.com","port":443,"id":"' + U + '"} x'),
        "vmess://" + b64({"add": "example.com", "port": 443, "id": U}, url=True) + "#frag",
        "vmess://" + b64({"add": "example.com", "port": 443, "id": U}) + "?x=1",
        "vmess://" + b64({"add": "example.com", "port": 443, "id": U}, pad=True),
        "vmess://" + b64({"add": "example.com", "port": 443, "id": U}) + "=",
    ]
    return v


def mutate(rng, uri):
    chars = list(uri)
    alphabet = list("%@:/?#&=[]+-_.~ \t\\\"'<>`") + ["\u00a0", "\u0646", "\U0001f600", "\u212a", "%0A", "%25", "%D9"]
    for _ in range(rng.randint(1, 3)):
        op = rng.random()
        pos = rng.randrange(len(chars) + 1) if chars else 0
        if op < 0.4:
            chars.insert(pos, rng.choice(alphabet + [rng.choice("abcdefXYZ0123456789")]))
        elif op < 0.7 and chars:
            del chars[min(pos, len(chars) - 1)]
        elif chars:
            chars[min(pos, len(chars) - 1)] = rng.choice(alphabet)
    return "".join(chars)


def result(uri):
    try:
        c = parse_config(uri)
        return {"uri": uri, "ok": True, **{k: c[k] for k in ("id", "protocol", "name", "host", "port")}}
    except InvalidConfig:
        return {"uri": uri, "ok": False}


def main():
    rng = random.Random(20261030)
    uris = adversarial()
    real = []
    for path in sys.argv[1:]:
        real.extend(extract_candidates(Path(path).read_text(encoding="utf-8-sig")))
    sample = rng.sample(real, min(len(real), 400)) if real else []
    fuzz_base = uris + sample
    fuzz = [mutate(rng, rng.choice(fuzz_base)) for _ in range(900)]
    seen, cases = set(), []
    for uri in uris + sample + fuzz:
        if uri in seen:
            continue
        seen.add(uri)
        cases.append(result(uri))
    texts = [
        f"# configs\n<vless://{U}@example.com:443>\ntrojan://a@example.com:443\n",
        "not a subscription", "", "\u00a0trojan://a@example.com:443\u3000ss://x",
        "TROJAN://a@b:1 'vmess://abc' \"x\" `hy2://p@h` hysteria2://p@h\u2028tuic://u",
        "\u017f\u017f://abc vle\u017fs://d HY\u0130A2 hyster\u0131a2://p@h",
    ]
    texts.append(b64(texts[0]))
    texts.append(" \n".join([b64(texts[0])[i:i + 7] for i in range(0, len(b64(texts[0])), 7)]))
    texts.append(b64("\ufeff" + texts[0]))
    texts.append(b64(b"\xff\xfe trojan://a@b:1"))
    extract = [{"text": t, "candidates": extract_candidates(t)} for t in texts]
    b64cases = []
    for value in ["%%%", "a", "", "abc=bad", "ab==", "abc=", "abcd", "abc", "ab", "ab=", "YR", "YR==", "YWJjZA",
                  "====", "==", "=", "Zm9v-_", "ZmZm+/", "abcd==", "abc==", "abcd=", "Zm9v\n", "Zm 9v"]:
        try:
            b64cases.append({"value": value, "ok": True, "hex": decode_base64(value).hex()})
        except InvalidConfig:
            b64cases.append({"value": value, "ok": False})
    json.dump({"python": sys.version.split()[0], "reference": "collector/protocols.py (baseline 63ff30d)",
               "parse": cases, "extract": extract, "base64": b64cases}, sys.stdout, ensure_ascii=False, indent=0)


if __name__ == "__main__":
    main()


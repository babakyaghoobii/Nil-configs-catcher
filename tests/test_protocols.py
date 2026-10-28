import base64
import json
import unittest

from collector.protocols import InvalidConfig, MAX_CANDIDATES, decode_base64, extract_candidates, parse_config

UUID = "12345678-1234-4321-8321-123456789abc"


def b64(value):
    if isinstance(value, dict):
        value = json.dumps(value)
    return base64.b64encode(value.encode()).decode().rstrip("=")


class ProtocolTests(unittest.TestCase):
    def test_all_six_protocols_and_alias(self):
        examples = {
            "vless": f"vless://{UUID}@example.com:443?security=tls#Test",
            "vmess": "vmess://" + b64({"v": "2", "add": "example.com", "port": "443", "id": UUID, "ps": "Test"}),
            "trojan": "trojan://secret@example.com:443?security=tls",
            "ss": "ss://" + b64("aes-256-gcm:secret") + "@example.com:8388",
            "hysteria2": "hy2://secret@example.com:443?sni=example.com",
            "tuic": f"tuic://{UUID}:secret@example.com:443?congestion_control=bbr",
        }
        for protocol, uri in examples.items():
            with self.subTest(protocol=protocol):
                config = parse_config(uri)
                self.assertEqual(config["protocol"], protocol)
                self.assertEqual(len(config["id"]), 64)
                self.assertEqual(config["uri"], uri)

    def test_label_and_query_order_do_not_create_new_identity(self):
        first = f"vless://{UUID}@EXAMPLE.com:443?type=ws&security=tls#One"
        second = f"vless://{UUID}@example.com:443?security=tls&type=ws#Two"
        self.assertEqual(parse_config(first)["id"], parse_config(second)["id"])

    def test_vmess_json_order_and_label_are_not_identity(self):
        config = {"add": "EXAMPLE.com", "port": "443", "id": UUID, "ps": "One", "aid": "0"}
        first = parse_config("vmess://" + b64(config))
        second = parse_config("vmess://" + b64({"aid": 0, "ps": "Two", "id": UUID, "port": 443, "add": "example.com"}))
        self.assertEqual(first["id"], second["id"])

    def test_credentials_and_transport_are_identity(self):
        self.assertNotEqual(parse_config("trojan://a@example.com:443")["id"], parse_config("trojan://b@example.com:443")["id"])
        self.assertNotEqual(parse_config("trojan://a@example.com:443?type=ws")["id"], parse_config("trojan://a@example.com:443?type=grpc")["id"])

    def test_ss_legacy_and_sip002_have_same_identity(self):
        legacy = "ss://" + b64("aes-256-gcm:secret@example.com:8388")
        modern = "ss://" + b64("aes-256-gcm:secret") + "@example.com:8388"
        self.assertEqual(parse_config(legacy)["id"], parse_config(modern)["id"])

    def test_ipv6_and_hy2_default_port(self):
        self.assertEqual(parse_config("trojan://secret@[2001:db8::1]:443")["host"], "2001:db8::1")
        self.assertEqual(parse_config("hysteria2://secret@example.com")["port"], 443)
        self.assertEqual(parse_config("hy2://secret@example.com")["id"], parse_config("hysteria2://secret@example.com:443")["id"])

    def test_encoded_password_and_persian_label(self):
        value = parse_config("trojan://a%40b@example.com:443#%D9%86%DB%8C%D9%84")
        self.assertEqual(value["name"], "نیل")

    def test_reject_malformed_input(self):
        bad = [
            "https://example.com/config", "vless://not-a-uuid@example.com:443", "trojan://@example.com:443",
            "trojan://secret@example.com:0", "trojan://secret@example.com:65536", "trojan://secret@example.com:443.0",
            "trojan://secret@999.999.999.999:443", "trojan://secret@-bad.example:443",
            "trojan://secret@example.com:443/remote", "trojan://a%0Ab@example.com:443", "trojan://a%ZZ@example.com:443",
            "trojan://a@example.com:443?a=1&a=2", "trojan://a@example.com:443?x=%ff", "trojan://a@example.com:443#bad label",
            f"tuic://{UUID}@example.com:443", "ss://" + b64("bad:secret") + "@example.com:8388",
            "vmess://%bad", "vmess://" + b64("[]"), "vmess://" + b64('{"id":"a","id":"b"}'),
            "trojan://" + "a" * 17000 + "@example.com:443", "trojan://a@example.com\\evil:443",
        ]
        for value in bad:
            with self.subTest(uri=value[:80]):
                with self.assertRaises(InvalidConfig):
                    parse_config(value)

    def test_non_string_vmess_uuid_is_rejected_safely(self):
        with self.assertRaises(InvalidConfig):
            parse_config("vmess://" + b64({"add": "example.com", "port": 443, "id": 42}))

    def test_controls_hidden_in_base64_are_rejected(self):
        values = [
            "ss://" + b64("aes-256-gcm:pass\nword") + "@example.com:8388",
            "ss://" + b64("aes-256-gcm:pass@example.com:\n8388"),
            "vmess://" + b64({"add": "example.com", "port": 443, "id": UUID, "path": "/ws\n"}),
        ]
        for value in values:
            with self.subTest(value=value), self.assertRaises(InvalidConfig):
                parse_config(value)

    def test_plaintext_and_base64_subscriptions(self):
        body = f"# configs\n<vless://{UUID}@example.com:443>\ntrojan://a@example.com:443\n"
        self.assertEqual(len(extract_candidates(body)), 2)
        self.assertEqual(extract_candidates(b64(body)), extract_candidates(body))
        self.assertEqual(extract_candidates("not a subscription"), [])

    def test_candidate_scan_is_bounded(self):
        self.assertEqual(len(extract_candidates("trojan://a@example.com:443\n" * (MAX_CANDIDATES + 2))), MAX_CANDIDATES)

    def test_base64_is_strict(self):
        for value in ("%%%", "a", "", "abc=bad"):
            with self.subTest(value=value), self.assertRaises(InvalidConfig):
                decode_base64(value)


if __name__ == "__main__":
    unittest.main()

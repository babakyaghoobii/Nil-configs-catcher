import socket
import unittest
from unittest.mock import patch

from collector.probe import outbound, public_address

URI = "vless://5783a3e7-e373-51cd-8642-c83782b807c5@example.com:443"


class ProbeTests(unittest.TestCase):
    def test_tls_websocket_preserves_routing_and_verification(self):
        config = outbound(URI + "?security=tls&type=ws&sni=edge.example.org&host=origin.example.org&path=%2Fws")
        stream = config["streamSettings"]
        self.assertEqual(stream["tlsSettings"]["serverName"], "edge.example.org")
        self.assertFalse(stream["tlsSettings"].get("allowInsecure", False))
        self.assertEqual(stream["wsSettings"], {"path": "/ws", "host": "origin.example.org"})

    def test_skips_unsupported_or_ambiguous_transport(self):
        for query in ("security=none", "security=reality", "security=tls&type=grpc",
                      "security=tls&type=ws&path=%2F%2Fexample.com",
                      "security=tls&allowInsecure=1"):
            with self.subTest(query=query):
                self.assertIsNone(outbound(URI + "?" + query))

    @patch("collector.probe.socket.getaddrinfo")
    def test_pins_public_addresses_and_rejects_mixed_dns_answers(self, resolve):
        public = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))
        private = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))
        resolve.return_value = [public]
        self.assertEqual(public_address("example.com", 443), "8.8.8.8")
        resolve.return_value = [public, private]
        with self.assertRaisesRegex(ValueError, "Non-public"):
            public_address("example.com", 443)

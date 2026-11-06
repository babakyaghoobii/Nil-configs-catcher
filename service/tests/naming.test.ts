import test from "node:test";
import assert from "node:assert/strict";
import { babakName, renameForClient } from "../naming.ts";
import { parseConfig } from "../protocols.ts";

test("protocol aliases and persistent six-digit grouping", () => {
  assert.equal(babakName("hysteria2", 1), "Babak-h2-00-00-01");
  assert.equal(babakName("vless", 2), "Babak-vlss-00-00-02");
  assert.equal(babakName("vmess", 100), "Babak-vm-00-01-00");
  assert.throws(() => babakName("vless", 0));
});

test("VLESS imported name changes without changing endpoint identity", async () => {
  const uri = "vless://12345678-1234-4321-8321-123456789abc@example.com:443?type=ws#Old";
  const parsed = await parseConfig(uri);
  const renamed = renameForClient(parsed, 2);
  assert.equal(renamed.name, "Babak-vlss-00-00-02");
  assert.match(renamed.uri, /#Babak-vlss-00-00-02$/);
  assert.equal((await parseConfig(renamed.uri)).id, parsed.id);
});

test("VMess ps changes without changing endpoint identity", async () => {
  const body = JSON.stringify({v:"2",add:"example.com",port:"443",id:"12345678-1234-4321-8321-123456789abc",ps:"Original"});
  const uri = "vmess://" + btoa(body);
  const parsed = await parseConfig(uri);
  const renamed = renameForClient(parsed, 3);
  assert.equal(renamed.name, "Babak-vm-00-00-03");
  const payload = renamed.uri.slice("vmess://".length);
  assert.equal(JSON.parse(atob(payload)).ps,"Babak-vm-00-00-03");
  assert.equal((await parseConfig(renamed.uri)).id, parsed.id);
});

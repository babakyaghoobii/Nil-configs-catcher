import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseConfig, extractCandidates } from "../protocols.ts";
import { decodeBase64, hasLoneSurrogate } from "../text.ts";
import {
  CollectorStore,
  type ConfigRecord,
  type RunReport,
} from "../database.ts";
import {
  canonicalRoot,
  collectNow,
  ensureInitialized,
  readRaw,
  validateSources,
  type Fetcher,
} from "../pipeline.ts";
import { handleCollectorAPI } from "../api.ts";
import { TestDatabase } from "./sqlite.ts";

const source = (id: string) => ({
  id,
  name: `Public ${id}`,
  owner: "example",
  repo: id,
  ref: "main",
  path: "list.txt",
  enabled: true,
});
const manifest = { version: 1, sources: [source("one"), source("two")] };
const ref = {
  id: "one",
  name: "Public one",
  url: "https://github.com/example/one/blob/main/list.txt",
};
const status: RunReport = {
  schemaVersion: 1,
  state: "success",
  startedAt: "2026-01-01T00:00:00Z",
  finishedAt: "2026-01-01T00:00:01Z",
  lastSuccessfulAt: "2026-01-01T00:00:01Z",
  added: 1,
  target: 50,
  totalUnique: 1,
  duplicateCount: 0,
  invalidCount: 0,
  scheduleHours: 2,
  snapshotLimit: 1000,
  sources: [
    {
      ...ref,
      status: "success",
      candidates: 1,
      valid: 1,
      invalid: 0,
      added: 1,
      error: null,
    },
  ],
  errors: [],
  connectionTested: false,
};

async function fixture() {
  const record: ConfigRecord = {
    ...(await parseConfig("trojan://bootstrap@example.com:443")),
    firstSeenAt: status.startedAt!,
    sources: [ref],
  };
  const calls: string[] = [];
  let offline = false;
  const fetcher: Fetcher = async (url, init) => {
    calls.push(url);
    assert.equal(init?.redirect, "manual");
    assert.ok(
      url.startsWith("https://raw.githubusercontent.com/"),
      "Unsafe network destination",
    );
    if (offline) throw new TypeError("Simulated network failure");
    const values: Record<string, unknown> = {
      [canonicalRoot + "sources.json"]: manifest,
      [canonicalRoot + "public/data/configs.json"]: {
        schemaVersion: 1,
        generatedAt: status.startedAt,
        totalUnique: 1,
        configs: [record],
      },
      [canonicalRoot + "public/data/status.json"]: status,
      [canonicalRoot + "public/data/history.json"]: [status],
      [canonicalRoot + "data/seen.json"]: [record.id],
    };
    if (url in values) return Response.json(values[url]);
    if (url.includes("/example/one/"))
      return new Response(
        Array.from(
          { length: 8 },
          (_, i) => `trojan://one-${i}@example.com:443#One`,
        ).join("\n"),
      );
    if (url.includes("/example/two/"))
      return new Response(
        Array.from(
          { length: 8 },
          (_, i) => `trojan://two-${i}@example.com:443#Two`,
        ).join("\n"),
      );
    throw new Error("Unexpected URL");
  };
  const db = new TestDatabase();
  const store = new CollectorStore(db);
  await ensureInitialized(store, fetcher);
  return {
    db,
    store,
    fetcher,
    calls,
    record,
    offline: () => {
      offline = true;
    },
  };
}
const cool = (db: TestDatabase) =>
  db.connection.exec("UPDATE nil_locks SET next_at=0,expires_at=0,owner=NULL");

test("canonical IDs match Python across 1,085 adversarial/fuzz inputs and decoding/extraction contracts", async () => {
  const fixtures = JSON.parse(
    execFileSync("python3", ["service/tests/gen_parser_fixtures.py"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  let accepted = 0,
    stricter = 0;
  for (const row of fixtures.parse) {
    let parsed, failure;
    try {
      parsed = await parseConfig(row.uri);
    } catch (error) {
      failure = error as Error;
    }
    if (
      row.ok &&
      (failure?.message === "Unsupported internationalized hostname" ||
        hasLoneSurrogate(row.name || ""))
    ) {
      stricter++;
      continue;
    }
    assert.equal(!failure, row.ok, String(row.uri).slice(0, 200));
    if (row.ok) {
      for (const key of ["id", "protocol", "name", "host", "port"])
        assert.deepEqual(parsed![key], row[key]);
      accepted++;
    }
  }
  assert.ok(accepted > 100);
  assert.equal(
    stricter,
    4,
    "Only documented IDNA/invalid-Unicode restrictions may differ",
  );
  for (const row of fixtures.extract)
    assert.deepEqual(extractCandidates(row.text), row.candidates);
  for (const row of fixtures.base64) {
    if (row.ok) decodeBase64(row.value);
    else assert.throws(() => decodeBase64(row.value));
  }
});

test("all actually committed public snapshot IDs also match the server parser", async () => {
  const snapshot = JSON.parse(readFileSync("public/data/configs.json", "utf8"));
  for (const record of snapshot.configs)
    assert.equal((await parseConfig(record.uri)).id, record.id);
});

test("source components are revalidated and injected URLs cannot change the fetch target", () => {
  const checked = validateSources({
    version: 1,
    sources: [{ ...source("one"), fetchUrl: "http://169.254.169.254/" }],
  });
  assert.equal(
    checked[0].fetchUrl,
    "https://raw.githubusercontent.com/example/one/main/list.txt",
  );
  for (const patch of [
    { path: "../private" },
    { owner: "example@evil.test" },
    { ref: "main?q=x" },
    { path: "a/%2e%2e/b" },
  ])
    assert.throws(() =>
      validateSources({
        version: 1,
        sources: [{ ...source("one"), ...patch }],
      }),
    );
});

test("fetching rejects redirects, invalid UTF-8, private destinations and oversized sources", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    readRaw(
      "http://127.0.0.1/",
      async () => {
        throw new Error("Must not fetch");
      },
      100,
      signal,
    ),
  );
  await assert.rejects(
    readRaw(
      canonicalRoot + "sources.json",
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/" },
        }),
      100,
      signal,
    ),
  );
  await assert.rejects(
    readRaw(
      canonicalRoot + "sources.json",
      async () => new Response(new Uint8Array([255])),
      100,
      signal,
    ),
  );
  await assert.rejects(
    readRaw(
      canonicalRoot + "sources.json",
      async () => new Response("x".repeat(101)),
      100,
      signal,
    ),
  );
});

test("stream timeout aborts a slow response without accepting partial content", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    readRaw(
      canonicalRoot + "sources.json",
      async () =>
        new Response(
          new ReadableStream({
            pull() {
              return new Promise(() => {});
            },
          }),
        ),
      100,
      controller.signal,
    ),
  );
  clearTimeout(timer);
});

test("bootstrap is coherent, permanent and idempotent", async () => {
  const f = await fixture();
  try {
    const first = await f.store.snapshot();
    await ensureInitialized(f.store, f.fetcher);
    const next = await f.store.snapshot();
    assert.equal(first.snapshot.totalUnique, 1);
    assert.equal(first.snapshot.configs[0].id, f.record.id);
    assert.deepEqual(next, first);
    assert.match(first.datasetId, /^[a-f0-9-]{36}$/);
  } finally {
    f.db.close();
  }
});

test("manual collection persists only genuinely new records and interleaves sources", async () => {
  const f = await fixture();
  try {
    const data = await collectNow(f.store, 2, f.fetcher);
    assert.equal(data.status.added, 2);
    assert.equal(data.snapshot.totalUnique, 3);
    assert.deepEqual(
      data.status.sources.map((item) => item.added),
      [1, 1],
    );
    assert.equal(data.history[0].runId, data.status.runId);
    assert.equal(new Set(data.snapshot.configs.map((row) => row.id)).size, 3);
    assert.equal(data.status.connectionTested, false);
    assert.ok(
      f.calls.every((url) =>
        url.startsWith("https://raw.githubusercontent.com/"),
      ),
    );
  } finally {
    f.db.close();
  }
});

test("global cooldown rejects duplicate work and permanent registry survives later runs", async () => {
  const f = await fixture();
  try {
    await collectNow(f.store, 50, f.fetcher);
    await assert.rejects(
      collectNow(f.store, 50, f.fetcher),
      (error: any) => error.code === 429 && error.retryAfter > 0,
    );
    cool(f.db);
    const next = await collectNow(f.store, 50, f.fetcher);
    assert.equal(next.status.added, 0);
    assert.equal(next.snapshot.totalUnique, 17);
    assert.equal(next.history.length, 3);
  } finally {
    f.db.close();
  }
});

test("total source failure records failure and retains all previous configs", async () => {
  const f = await fixture();
  try {
    const before = await f.store.snapshot();
    f.offline();
    const after = await collectNow(f.store, 50, f.fetcher);
    assert.equal(after.status.state, "failed");
    assert.equal(after.status.added, 0);
    assert.deepEqual(after.snapshot.configs, before.snapshot.configs);
    assert.equal(after.status.lastSuccessfulAt, before.status.lastSuccessfulAt);
  } finally {
    f.db.close();
  }
});

test("expired lease cannot insert stale records or a fake successful report", async () => {
  const f = await fixture();
  try {
    const owner = crypto.randomUUID();
    assert.ok(await f.store.acquire("collect", owner, Date.now()));
    f.db.connection.exec(
      "UPDATE nil_locks SET expires_at=0 WHERE name='collect'",
    );
    const row = {
      ...(await parseConfig("trojan://stale@example.com:443")),
      firstSeenAt: status.startedAt!,
      sources: [ref],
    };
    await assert.rejects(f.store.finish(owner, [row], status, {}, Date.now()));
    assert.equal((await f.store.snapshot()).snapshot.totalUnique, 1);
  } finally {
    f.db.close();
  }
});

test("two concurrent actors cannot both acquire the collection lease", async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([
      f.store.acquire("collect", crypto.randomUUID(), Date.now()),
      new CollectorStore(f.db).acquire(
        "collect",
        crypto.randomUUID(),
        Date.now(),
      ),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
  } finally {
    f.db.close();
  }
});

test("API subscription is a real grouped response with matching decoded URIs", async () => {
  const f = await fixture();
  try {
    await collectNow(f.store, 2, f.fetcher);
    const response = await handleCollectorAPI(
      new Request(
        "https://nil.example/api/subscription?protocol=trojan&source=one&format=base64&title=NIL",
      ),
      f.db,
      f.fetcher,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("profile-update-interval"), "2");
    const body = Buffer.from(await response.text(), "base64").toString("utf8");
    assert.equal(body.trim().split("\n").length, 2);
    assert.ok(body.includes("trojan://one-0@example.com:443"));
    assert.ok(!body.includes("two-0"));
  } finally {
    f.db.close();
  }
});

test("API rejects URL injection, duplicate keys, cross-site mutation, bad formats and methods", async () => {
  const f = await fixture();
  try {
    for (const request of [
      new Request("https://nil.example/api/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"url":"http://127.0.0.1"}',
      }),
      new Request("https://nil.example/api/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"limit":1,"limit":50}',
      }),
      new Request(
        "https://nil.example/api/subscription?protocol=trojan&protocol=ss",
      ),
      new Request("https://nil.example/api/subscription?format=json"),
      new Request(
        "https://nil.example/api/subscription?source=http://127.0.0.1/",
      ),
    ])
      assert.equal(
        (await handleCollectorAPI(request, f.db, f.fetcher)).status,
        400,
      );
    const evil = await handleCollectorAPI(
      new Request("https://nil.example/api/collect", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      }),
      f.db,
      f.fetcher,
    );
    assert.equal(evil.status, 403);
    assert.equal(
      (
        await handleCollectorAPI(
          new Request("https://nil.example/api/collect"),
          f.db,
          f.fetcher,
        )
      ).status,
      405,
    );
  } finally {
    f.db.close();
  }
});

test("export cursor gives all committed records without duplication or skipped pages", async () => {
  const f = await fixture();
  try {
    const data = await collectNow(f.store, 2, f.fetcher);
    let cursor = 0;
    const ids: string[] = [];
    for (;;) {
      const page = await f.store.exportPage(cursor, data.checkpoint, 1);
      ids.push(...page.records.map((row) => row.id));
      cursor = page.cursor;
      if (page.done) break;
    }
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3);
  } finally {
    f.db.close();
  }
});

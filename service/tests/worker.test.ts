import test from "node:test";
import assert from "node:assert/strict";
import worker, { type WorkerEnv } from "../worker.ts";
import { TestDatabase } from "./sqlite.ts";
import { CollectorStore, type RunReport } from "../database.ts";
import { parseConfig } from "../protocols.ts";
import { latency } from "../latency.ts";

const origin = "https://nil-config-catcher.nil-tests.workers.dev";
const assets: WorkerEnv["ASSETS"] = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/index.html") return Response.redirect(origin + "/", 301);
    if (path === "/error") throw new Error("Fixture failure");
    return new Response(path === "/" ? "NIL fixture HTML" : "asset", {
      headers: {
        "Content-Type": path === "/" ? "text/html" : "text/javascript",
      },
    });
  },
};

test("standalone public app and assets require no platform session and carry security headers", async () => {
  for (const path of ["/", "/assets/app.js", "/index.html", "/error"]) {
    const response = await worker.fetch(new Request(origin + path), {
      ASSETS: assets,
    });
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.match(
      response.headers.get("Content-Security-Policy")!,
      /frame-ancestors 'none'/,
    );
    assert.notEqual(response.status, 401);
    assert.equal(
      response.status,
      path === "/index.html" ? 301 : path === "/error" ? 503 : 200,
    );
  }
});

test("PWA worker updates cannot be cached indefinitely and POST never falls through to assets", async () => {
  const response = await worker.fetch(new Request(origin + "/sw.js"), {
    ASSETS: assets,
  });
  assert.equal(response.headers.get("Cache-Control"), "no-cache");
  assert.equal(response.headers.get("Service-Worker-Allowed"), "/");
  const denied = await worker.fetch(
    new Request(origin + "/", { method: "POST" }),
    { ASSETS: assets },
  );
  assert.equal(denied.status, 405);
});

test("robots and sitemap use this deployment origin and HEAD responses have no body", async () => {
  for (const path of ["/robots.txt", "/sitemap.xml"]) {
    const response = await worker.fetch(new Request(origin + path), {
      ASSETS: assets,
    });
    assert.ok((await response.text()).includes(origin));
    const head = await worker.fetch(
      new Request(origin + path, { method: "HEAD" }),
      { ASSETS: assets },
    );
    assert.equal(await head.text(), "");
  }
});

test("missing and uninitialized databases return honest 503 responses, not static HTML", async () => {
  const db = new TestDatabase();
  try {
    for (const DB of [undefined, db]) {
      const response = await worker.fetch(new Request(origin + "/api/data"), {
        ASSETS: assets,
        DB,
      });
      assert.equal(response.status, 503);
      assert.ok(((await response.json()) as { error: string }).error);
    }
  } finally {
    db.close();
  }
});

test("public API and base64 subscription use real SQLite data without exposing bindings", async () => {
  const db = new TestDatabase();
  const store = new CollectorStore(db);
  const source = {
    id: "fixture",
    name: "Public fixture",
    url: "https://github.com/example/public/blob/main/list.txt",
  };
  const record = {
    ...(await parseConfig("trojan://fixture@example.com:443")),
    firstSeenAt: "2026-01-01T00:00:00Z",
    sources: [source],
  };
  const report: RunReport = {
    schemaVersion: 1,
    state: "success",
    startedAt: record.firstSeenAt,
    finishedAt: record.firstSeenAt,
    lastSuccessfulAt: record.firstSeenAt,
    added: 1,
    target: 50,
    totalUnique: 1,
    duplicateCount: 0,
    invalidCount: 0,
    scheduleHours: 2,
    snapshotLimit: 1000,
    sources: [],
    errors: [],
    connectionTested: false,
  };
  try {
    assert.equal(
      await store.acquire("bootstrap", "test-owner", Date.now()),
      true,
    );
    await store.bootstrap(
      [record],
      [record.id],
      report,
      [report],
      {
        version: 1,
        sources: [
          {
            id: source.id,
            name: source.name,
            owner: "example",
            repo: "public",
            ref: "main",
            path: "list.txt",
          },
        ],
      },
      "test-owner",
    );
    const data = await worker.fetch(new Request(origin + "/api/data"), {
      DB: db,
      ASSETS: assets,
    });
    const batch = (await data.json()) as {
      snapshot: { configs: (typeof record)[] };
    };
    assert.equal(batch.snapshot.configs[0].id, record.id);
    const feed = await worker.fetch(
      new Request(origin + "/api/subscription?format=base64"),
      { DB: db, ASSETS: assets },
    );
    assert.equal(atob(await feed.text()).trim(), `${record.uri}#Babak-tr-00-00-01`);
    const profile = await worker.fetch(new Request(origin + "/api/profile?id=" + record.id),
      { DB: db, ASSETS: assets });
    assert.equal(profile.status, 200);
    assert.equal(atob(await profile.text()), batch.snapshot.configs[0].uri + "\n");
    for (const [params, status] of [["id=" + "0".repeat(64), 404], ["id=" + record.id + "&url=localhost", 400]] as const) {
      const rejected = await worker.fetch(new Request(origin + "/api/profile?" + params), { DB: db, ASSETS: assets });
      assert.equal(rejected.status, status);
    }

    const probeRequest = () => new Request(origin + "/api/latency?id=" + record.id, {
      method: "POST",
      headers: { Origin: "https://babakyaghoobii.github.io", "CF-Connecting-IP": "8.8.8.8" },
    });
    const guard = { DB: db, LATENCY_LIMITER: { limit: async () => ({ success: true }) } };
    const neverDial = () => assert.fail("Unsafe DNS result reached the socket");
    const mixed = await latency(probeRequest(), guard, neverDial, async () => Response.json({
      Status: 0, Answer: [{ type: 1, data: "8.8.8.8" }, { type: 1, data: "127.0.0.1" }],
    }));
    assert.deepEqual(await mixed.json(), { state: "unsupported" });
    const throttled = await latency(probeRequest(), {
      ...guard, LATENCY_LIMITER: { limit: async () => ({ success: false }) },
    }, neverDial, async () => assert.fail("Rate-limited request reached DNS"));
    assert.equal(throttled.status, 429);
    const unavailable = await worker.fetch(probeRequest(), { DB: db, ASSETS: assets });
    assert.equal(unavailable.status, 503);
    const malicious = await worker.fetch(
      new Request(origin + "/api/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"url":"http://127.0.0.1"}',
      }),
      { DB: db, ASSETS: assets },
    );
    assert.equal(malicious.status, 400);
  } finally {
    db.close();
  }
});

test("public measurements read the current canonical report without a database", async (t) => {
  const report = { schemaVersion: 1, results: {} };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(report));
  const response = await worker.fetch(new Request(origin + "/api/measurements"), { ASSETS: assets });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(await response.json(), report);
  assert.match(String(fetch.mock.calls[0]?.arguments[0]), /\/public\/data\/measurements\.json$/);
});

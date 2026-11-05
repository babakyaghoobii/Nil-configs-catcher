import { test, expect, type Page } from "@playwright/test";
import { createPreviewServer } from "../../scripts/serve.mjs";

// Page-level network fixtures cannot intercept requests owned by WebKit's
// installed service worker. Its real network behavior is exercised below.
test.use({ serviceWorkers: "block" });

const now = new Date().toISOString();
const source = {
  id: "fixture",
  name: "Public fixture",
  url: "https://github.com/example/public",
};
const row = (id: string, protocol = "trojan") => ({
  id: id.repeat(64),
  protocol,
  uri:
    protocol === "vless"
      ? `vless://12345678-1234-4321-8321-123456789abc@example.com:443#${id}`
      : `trojan://${id}@example.com:443`,
  name: `Fixture ${id}`,
  host: "example.com",
  port: 443,
  firstSeenAt: now,
  sources: [source],
});
function batch(extra = false) {
  const status = {
    schemaVersion: 1,
    state: "success",
    startedAt: now,
    finishedAt: now,
    lastSuccessfulAt: now,
    added: extra ? 1 : 2,
    target: 50,
    totalUnique: extra ? 3 : 2,
    duplicateCount: 0,
    invalidCount: 0,
    snapshotLimit: 1000,
    sources: [
      {
        ...source,
        status: "success",
        candidates: 2,
        valid: 2,
        invalid: 0,
        added: 2,
        error: null,
      },
    ],
    errors: [],
  };
  return {
    snapshot: {
      schemaVersion: 1,
      generatedAt: now,
      totalUnique: status.totalUnique,
      configs: [...(extra ? [row("c")] : []), row("a", "vless"), row("b")],
    },
    status,
    history: [status],
  };
}
async function data(page: Page) {
  await page.route("**/api/data", (route) => route.fulfill({ json: batch() }));
  await page.goto("./");
  await expect(page.locator(".config-card")).toHaveCount(2);
}

test("NIL theme choices persist and auto mode follows operating-system changes", async ({
  page,
}) => {
  await data(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "پوستهٔ روشن" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "پوستهٔ خودکار" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "پوستهٔ خودکار" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("a grouped subscription URL preserves selected protocol, source and title", async ({
  page,
}) => {
  await data(page);
  await page.locator('[data-protocol="vless"]').click();
  await page.getByRole("button", { name: "ساخت لینک اشتراک" }).click();
  await page.locator("#subscription-name").fill("مجموعهٔ نیل");
  await page.locator("#subscription-source").selectOption("fixture");
  await page.locator("#subscription-format").selectOption("plain");
  const link = new URL(await page.locator("#subscription-link").inputValue());
  expect(link.protocol).toBe("https:");
  expect(link.pathname).toBe("/api/subscription");
  expect(link.searchParams.get("protocol")).toBe("vless");
  expect(link.searchParams.get("source")).toBe("fixture");
  expect(link.searchParams.get("title")).toBe("مجموعهٔ نیل");
  expect(link.searchParams.get("format")).toBe("plain");
});

test("manual collection sends POST and inserts only the returned fresh records", async ({
  page,
}) => {
  await data(page);
  let count = 0;
  await page.route("**/api/collect", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ limit: 50 });
    count++;
    await route.fulfill({ json: batch(true) });
  });
  await page.locator('[data-action="collect-now"]').click();
  await expect(page.locator(".config-card")).toHaveCount(3);
  await expect(page.locator(".config-card").first()).toContainText("Fixture c");
  expect(count).toBe(1);
});

test("a busy collector keeps the existing list and exposes the actual retry delay", async ({
  page,
}) => {
  await data(page);
  await page.route("**/api/collect", (route) =>
    route.fulfill({
      status: 429,
      headers: { "Retry-After": "33" },
      json: { error: "Collection busy" },
    }),
  );
  await page.locator('[data-action="collect-now"]').click();
  await expect(page.getByRole("alert")).toContainText("۳۳");
  await expect(page.locator(".config-card")).toHaveCount(2);
  await expect(page.locator("#toast")).not.toContainText("دریافت شد");
});

test.describe("manual collection with a real installed service worker", () => {
  test.use({ serviceWorkers: "allow" });

  test("POST reaches the HTTP server after installation and retains data on a later 429", async ({ page }) => {
    const server = createPreviewServer();
    const staticHandlers = server.listeners("request");
    server.removeAllListeners("request");
    let collected = false;
    const requests: { method: string | undefined; body: string }[] = [];
    server.on("request", async (request, response) => {
      const path = new URL(request.url || "/", "http://localhost").pathname;
      if (!path.startsWith("/Nil-configs-catcher/api/")) {
        for (const handler of staticHandlers) handler.call(server, request, response);
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      if (path.endsWith("/data")) {
        response.end(JSON.stringify(batch(collected)));
        return;
      }
      let body = "";
      for await (const part of request) body += part;
      requests.push({ method: request.method, body });
      if (collected) {
        response.writeHead(429, { "Retry-After": "33" });
        response.end(JSON.stringify({ error: "Fixture cooldown" }));
        return;
      }
      collected = true;
      response.end(JSON.stringify(batch(true)));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    try {
      await page.goto(`http://127.0.0.1:${address.port}/Nil-configs-catcher/`);
      await expect(page.locator(".config-card")).toHaveCount(2);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      await page.reload();
      await expect(page.locator(".config-card")).toHaveCount(2);
      await page.locator('[data-action="collect-now"]').click();
      await expect(page.locator(".config-card")).toHaveCount(3);
      await page.locator('[data-action="collect-now"]').click();
      await expect(page.getByRole("alert")).toContainText("۳۳");
      await expect(page.locator(".config-card")).toHaveCount(3);
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.method).toBe("POST");
        expect(JSON.parse(request.body)).toEqual({ limit: 50 });
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

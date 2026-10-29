import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createPreviewServer } from "../../scripts/serve.mjs";

// Network fixtures must not be bypassed by a real installed service worker.
test.use({ serviceWorkers: "block" });

// Synthetic inputs exist ONLY in tests, never in the published dataset.
const now = new Date().toISOString();
const configs = ["vless", "vmess", "trojan", "ss", "hysteria2", "tuic"].map(
  (protocol, index) => ({
    id: String(index + 1).repeat(64),
    protocol,
    name: index === 0 ? "<img src=x onerror=alert(1)>" : `Test ${protocol}`,
    uri: `${protocol}://test-${index}@example.com:443`,
    host: "example.com",
    port: 443,
    firstSeenAt: now,
    sources: [
      {
        id: "test",
        name: "Test source",
        url: "https://github.com/example/public",
      },
    ],
  }),
);
const status = {
  schemaVersion: 1,
  state: "success",
  startedAt: now,
  finishedAt: now,
  lastSuccessfulAt: now,
  added: 6,
  target: 50,
  totalUnique: 6,
  duplicateCount: 3,
  invalidCount: 1,
  snapshotLimit: 1000,
  sources: [
    {
      id: "test",
      name: "Test source",
      url: "https://github.com/example/public",
      status: "success",
      valid: 6,
      invalid: 1,
      candidates: 7,
      added: 6,
      error: null,
    },
  ],
  errors: [],
};

async function fixture(page: import("@playwright/test").Page) {
  await page.route("**/data/*.json", async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop();
    await route.fulfill({
      json:
        file === "configs.json"
          ? { schemaVersion: 1, generatedAt: now, totalUnique: 6, configs }
          : file === "history.json"
            ? [status]
            : status,
    });
  });
  await page.goto("./");
  await expect(page.locator(".config-card")).toHaveCount(6);
}

test("RTL, no horizontal overflow, all protocols, safe rendering and no CSP errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await fixture(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("#creator-title")).toContainText("babakyaghoobii");
  await expect(page.locator(".creator-english")).toContainText(
    "Free for everyone to use",
  );
  await expect(page.locator(".creator-logo")).toBeVisible();
  await expect(page.locator(".creator-logo")).toHaveJSProperty(
    "naturalWidth",
    640,
  );
  await expect(page.locator(".config-card img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("protocol filtering, search, clearing, and filtered export", async ({
  page,
  isMobile,
}) => {
  await fixture(page);
  const tab = page.locator('[data-protocol="trojan"]');
  if (isMobile) await tab.tap();
  else await tab.click();
  await expect(page.locator(".config-card")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.locator('[data-action="export"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toContain("nil-trojan-");
  expect(await readFile((await file.path())!, "utf8")).toBe(
    configs[2].uri + "\n",
  );
  await page.locator("#search").fill("does-not-exist");
  await expect(page.getByText("نتیجه‌ای پیدا نشد")).toBeVisible();
  await page.locator('[data-action="clear-filters"]').click();
  await expect(page.locator(".config-card")).toHaveCount(6);
});

test("copy, share fallback, and persistent bookmarks", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    });
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
  });
  await fixture(page);
  await page.locator('[data-action="copy"]').first().click();
  await expect(page.locator("#toast")).toContainText("کپی شد");
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe(configs[0].uri);
  await page.locator('[data-action="share"]').first().click();
  await expect(page.locator("#toast")).toContainText("اشتراک");
  await page.locator('[data-action="save"]').first().click();
  await page.locator('[data-view="saved"]:visible').first().click();
  await expect(page.locator(".config-card")).toHaveCount(1);
  await page.reload();
  await page.locator('[data-view="saved"]:visible').first().click();
  await expect(page.locator(".config-card")).toHaveCount(1);
  await page.locator('[data-action="save"]').click();
  await expect(page.locator(".config-card")).toHaveCount(0);
});

test("sources, history, and install instructions work", async ({ page }) => {
  await fixture(page);
  await page.locator('[data-view="sources"]:visible').first().click();
  await expect(page.locator(".source-card")).toHaveCount(1);
  await expect(page.locator(".source-card a")).toHaveAttribute(
    "href",
    "https://github.com/example/public",
  );
  await page.locator('[data-view="history"]:visible').first().click();
  await expect(page.locator(".history-item")).toHaveCount(1);
  await page.locator('[data-action="install"]').click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.getByRole("button", { name: "متوجه شدم" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
});

test("native share receives the exact URI and cancelling is silent", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as unknown as { shared: ShareData }).shared = data;
      },
    });
  });
  await fixture(page);
  await page.locator('[data-action="share"]').first().click();
  expect(
    await page.evaluate(
      () => (window as unknown as { shared: ShareData }).shared.text,
    ),
  ).toBe(configs[0].uri);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    }),
  );
  await page.locator('[data-action="share"]').first().click();
  await expect(page.locator("#toast")).not.toHaveClass(/visible/);
});

test("failed refresh retains data and exposes an error instead of invented success", async ({
  page,
}) => {
  await fixture(page);
  await page.unroute("**/data/*.json");
  await page.route("**/data/*.json", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.locator('[data-action="refresh"]').click();
  await expect(page.getByRole("alert")).toContainText(
    "دریافت دادهٔ تازه ممکن نشد",
  );
  await expect(page.locator(".config-card")).toHaveCount(6);
});

test("stale and partial collection status are visible", async ({ page }) => {
  await page.route("**/data/*.json", async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop();
    const stale = {
      ...status,
      state: "partial",
      lastSuccessfulAt: "2020-01-01T00:00:00Z",
    };
    await route.fulfill({
      json:
        file === "configs.json"
          ? { schemaVersion: 1, generatedAt: now, totalUnique: 6, configs }
          : file === "history.json"
            ? [stale]
            : stale,
    });
  });
  await page.goto("./");
  await expect(page.locator(".refresh-strip")).toContainText("دریافت ناقص");
  await expect(page.locator(".notice.warning")).toContainText("بیش از");
});

test.describe("real offline installation", () => {
  test.use({ serviceWorkers: "allow" });
  test("published subpath assets, icons, manifest and real offline cache work", async ({
    page,
  }) => {
    // Stop an isolated real server. WebKit's setOffline emulation can reject
    // navigation before the service worker gets a chance to answer it.
    const server = createPreviewServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}/Nil-configs-catcher/`;
    try {
      await page.goto(base);
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.waitForFunction(() =>
        Boolean(navigator.serviceWorker.controller),
      );
      await expect(page.locator(".skeleton")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      for (const file of [
        "manifest.webmanifest",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/apple-touch-icon.png",
        "icons/favicon-32.png",
        "icons/maskable-512.png",
        "branding/creator-logo-charcoal.png",
        "branding/creator-logo.png",
        "sw.js",
      ]) {
        expect((await page.request.get(new URL(file, base).href)).ok()).toBe(
          true,
        );
      }
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "یک قدم تا اتصال." }),
      ).toBeVisible();
      await expect(page.locator(".notice.warning").first()).toContainText(
        "آفلاین",
      );
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.locator(".creator-logo")).toHaveJSProperty(
        "naturalWidth",
        640,
      );
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

import { test, expect, type Page } from "@playwright/test";
import { createPreviewServer } from "../../scripts/serve.mjs";

const dataPattern =
  "https://raw.githubusercontent.com/babakyaghoobii/Nil-configs-catcher/main/public/data/*.json";
const now = new Date().toISOString();
const row = {
  id: "e".repeat(64),
  protocol: "trojan",
  name: "Hosted fixture",
  host: "example.com",
  port: 443,
  uri: "trojan://fixture@example.com:443",
  firstSeenAt: now,
  sources: [
    {
      id: "fixture",
      name: "Public fixture",
      url: "https://github.com/example/public",
    },
  ],
};
const status = {
  schemaVersion: 1,
  state: "success",
  startedAt: now,
  finishedAt: now,
  lastSuccessfulAt: now,
  added: 1,
  target: 50,
  totalUnique: 1,
  duplicateCount: 0,
  invalidCount: 0,
  snapshotLimit: 1000,
  sources: [],
  errors: [],
};

async function liveData(page: Page) {
  await page.route(dataPattern, async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    await route.fulfill({
      json:
        name === "configs.json"
          ? {
              schemaVersion: 1,
              generatedAt: now,
              totalUnique: 1,
              configs: [row],
            }
          : name === "history.json"
            ? [status]
            : status,
    });
  });
}

test("public web app reads fresh GitHub data and retains browser PWA behavior", async ({
  page,
}) => {
  await liveData(page);
  await page.goto("./");
  await expect(page.locator(".config-card")).toHaveCount(1);
  await expect(page.locator(".config-card")).toContainText("Hosted fixture");
  await expect(page.locator(".creator-logo")).toHaveJSProperty(
    "naturalWidth",
    640,
  );
  await expect(page.locator("#creator-title")).toContainText("babakyaghoobii");
  await expect(page.locator(".install-button")).toBeVisible();
  await page.locator(".install-button").click();
  await expect(page.locator("#install-dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("https://raw.githubusercontent.com");
  expect(csp).not.toContain("ipc:");
});

test("GitHub failure restores validated browser data and rejects a corrupt cache", async ({
  page,
}) => {
  await liveData(page);
  await page.goto("./");
  await expect(page.locator(".config-card")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("nil-web-data-v1")))
    .not.toBeNull();
  await page.route(dataPattern, (route) => route.abort());
  await page.reload();
  await expect(page.locator(".config-card")).toHaveCount(1);
  await expect(page.locator(".notice.warning").first()).toContainText("آفلاین");
  await page.evaluate(() => localStorage.setItem("nil-web-data-v1", "corrupt"));
  await page.reload();
  await expect(page.locator(".config-card").first()).toBeVisible();
  await expect(page.locator(".config-card").first()).not.toContainText(
    "Hosted fixture",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("installed PWA reloads after the host stops and GitHub becomes unavailable", async ({
  page,
}) => {
  const server = createPreviewServer("dist-hosted", "/");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  try {
    await liveData(page);
    await page.goto(base);
    await expect(page.locator(".config-card")).toHaveCount(1);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() =>
      Boolean(navigator.serviceWorker.controller),
    );
    await page.route(dataPattern, (route) => route.abort());
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await page.reload();
    await expect(page.locator(".config-card")).toHaveCount(1);
    await expect(page.locator(".notice.warning").first()).toContainText(
      "آفلاین",
    );
    await expect(page.locator(".creator-logo")).toHaveJSProperty(
      "naturalWidth",
      640,
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import { test, expect } from "@playwright/test";

const now = new Date().toISOString();
const configs = ["trojan", "tuic"].map((protocol, index) => ({
  id: (index ? "b" : "a").repeat(64),
  protocol,
  name: `Native ${protocol}`,
  host: "example.com",
  port: 443,
  uri:
    protocol === "trojan"
      ? "trojan://fixture@example.com:443"
      : "tuic://12345678-1234-4321-8321-123456789abc:fixture@example.com:443",
  firstSeenAt: now,
  sources: [
    {
      id: "fixture",
      name: "Native fixture",
      url: "https://github.com/example/public",
    },
  ],
}));
const status = {
  schemaVersion: 1,
  state: "success",
  startedAt: now,
  finishedAt: now,
  lastSuccessfulAt: now,
  added: 2,
  target: 50,
  totalUnique: 2,
  duplicateCount: 0,
  invalidCount: 0,
  snapshotLimit: 1000,
  sources: [],
  errors: [],
};

type MockCall = {
  command: string;
  data: unknown;
  options: unknown;
  text: string | null;
};

test.beforeEach(async ({ page }) => {
  // Browser tests exercise the native UI's real plugin integration, with an IPC
  // double. Actual native binaries/installers are separately built/tested in CI.
  await page.addInitScript(() => {
    const runtime = {
      calls: [] as MockCall[],
      savePath: "/tmp/nil-export.txt" as string | null,
    };
    Object.assign(window, {
      nilMock: runtime,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, data: unknown, options: unknown) => {
          runtime.calls.push({
            command,
            data,
            options,
            text:
              data instanceof Uint8Array
                ? new TextDecoder().decode(data)
                : null,
          });
          return command === "plugin:dialog|save"
            ? runtime.savePath
            : undefined;
        },
      },
    });
  });
  await page.route(
    "https://raw.githubusercontent.com/babakyaghoobii/Nil-configs-catcher/main/public/data/*.json",
    async (route) => {
      const file = new URL(route.request().url()).pathname.split("/").pop();
      await route.fulfill({
        json:
          file === "configs.json"
            ? { schemaVersion: 1, totalUnique: 2, generatedAt: now, configs }
            : file === "history.json"
              ? [status]
              : status,
      });
    },
  );
});

test("desktop has creator credits, fetches live data and exposes no PWA installation flow", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".config-card")).toHaveCount(2);
  await expect(page.locator("#creator-title")).toContainText("babakyaghoobii");
  await expect(page.locator(".creator-logo")).toBeVisible();
  await expect(page.locator(".creator-logo")).toHaveJSProperty(
    "naturalWidth",
    640,
  );
  await expect(page.locator(".creator-english")).toContainText(
    "Free for everyone",
  );
  await expect(page.locator(".install-button")).toBeHidden();
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    ),
  ).toBe(0);
});

test("native copy and filtered export use the clipboard and a selected native file path", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".config-card")).toHaveCount(2);
  await page.locator('[data-action="copy"]').first().click();
  await expect(page.locator("#toast")).toContainText("کپی شد");
  await page.locator('[data-protocol="trojan"]').click();
  await page.locator('[data-action="export"]').click();
  await expect(page.locator("#toast")).toContainText("ذخیره شد");
  const calls = await page.evaluate(
    () =>
      (window as unknown as { nilMock: { calls: MockCall[] } }).nilMock.calls,
  );
  expect(
    (
      calls.find(
        (call) => call.command === "plugin:clipboard-manager|write_text",
      )!.data as { text: string }
    ).text,
  ).toBe(configs[0].uri);
  const write = calls.find(
    (call) => call.command === "plugin:fs|write_text_file",
  )!;
  expect(write.text).toBe(configs[0].uri + "\n");
  expect(
    decodeURIComponent(
      (write.options as { headers: { path: string } }).headers.path,
    ),
  ).toBe("/tmp/nil-export.txt");
});

test("cancelled native exports write nothing and GitHub links open through the scoped opener", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".config-card")).toHaveCount(2);
  await page.evaluate(() => {
    (
      window as unknown as { nilMock: { savePath: string | null } }
    ).nilMock.savePath = null;
  });
  await page.locator('[data-action="export"]').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { nilMock: { calls: MockCall[] } }
        ).nilMock.calls.some((call) => call.command === "plugin:dialog|save"),
      ),
    )
    .toBe(true);
  await page.locator(".github-link").click();
  // The opener module is lazy-loaded; clicking does not await its IPC call.
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { nilMock: { calls: MockCall[] } }
        ).nilMock.calls.some(
          (call) => call.command === "plugin:opener|open_url",
        ),
      ),
    )
    .toBe(true);
  const calls = await page.evaluate(
    () =>
      (window as unknown as { nilMock: { calls: MockCall[] } }).nilMock.calls,
  );
  expect(
    calls.some((call) => call.command === "plugin:fs|write_text_file"),
  ).toBe(false);
  expect(
    (
      calls.find((call) => call.command === "plugin:opener|open_url")!.data as {
        url: string;
      }
    ).url,
  ).toBe("https://github.com/babakyaghoobii/Nil-configs-catcher");
});

test("desktop restarts offline with its last validated data and rejects corrupt caches", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".config-card")).toHaveCount(2);
  await page.unroute(
    "https://raw.githubusercontent.com/babakyaghoobii/Nil-configs-catcher/main/public/data/*.json",
  );
  await page.route("https://raw.githubusercontent.com/**", (route) =>
    route.abort(),
  );
  await page.reload();
  await expect(page.locator(".config-card")).toHaveCount(2);
  await expect(page.locator(".notice.warning").first()).toContainText("آفلاین");
  await page.evaluate(() =>
    localStorage.setItem("nil-desktop-data-v1", "{corrupt"),
  );
  await page.reload();
  await expect(page.locator(".config-card").first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

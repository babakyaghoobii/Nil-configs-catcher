import { expect, test } from "@playwright/test";

test("NIL Proxy groups published configs and hands the exact selection to the native client", async ({ page }) => {
  await page.goto("proxy/");
  await expect(page.getByRole("heading", { name: "NIL Proxy", exact: true })).toBeVisible();
  await expect(page.locator("#collectorStatus")).toContainText("آخرین اسنپ‌شات منتشرشده");
  await page.locator('[data-filter="vless"]').click();
  await expect(page.locator(".node .protocol").first()).toHaveText("VLESS");
  const first = page.locator("[data-select]").first();
  const id = await first.getAttribute("data-select");
  expect(id).toMatch(/^[a-f0-9]{64}$/);
  await first.click();
  await page.locator('.bottomnav [data-tab="connect"]').click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("combobox")).toHaveValue(id!);
  const native = new URL((await sheet.locator("#startConnection").getAttribute("href"))!);
  expect(native.protocol).toBe("hiddify:");
  expect(native.hostname).toBe("import");
  const profile = new URL(native.searchParams.get("url")!);
  expect(profile.pathname).toBe("/api/profile");
  expect(profile.searchParams.get("id")).toBe(id);
  await expect(sheet.locator("#connectStatus")).toContainText("کلاینت بومی");
  expect((await page.request.get("proxy/apple-touch-icon.png")).ok()).toBe(true);
});

test("the Catcher service worker keeps the Proxy navigation distinct", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.goto("proxy/");
  await expect(page.getByRole("heading", { name: "Config Manager" })).toBeVisible();
});

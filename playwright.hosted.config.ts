import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/hosted",
  workers: 2,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4175/", trace: "retain-on-failure" },
  projects: [
    {
      name: "hosted-chromium",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "hosted-iphone-16",
      use: {
        browserName: "webkit",
        viewport: { width: 393, height: 852 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
  webServer: {
    command: "node scripts/serve.mjs --hosted",
    port: 4175,
    reuseExistingServer: !process.env.CI,
  },
});

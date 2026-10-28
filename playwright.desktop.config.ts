import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/desktop",
  workers: 2,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4174/Nil-configs-catcher/",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "native-ui-chromium",
      use: { browserName: "chromium", viewport: { width: 1180, height: 850 } },
    },
    {
      name: "native-ui-webkit",
      use: { browserName: "webkit", viewport: { width: 1180, height: 850 } },
    },
  ],
  webServer: {
    command: "node scripts/serve.mjs --desktop",
    port: 4174,
    reuseExistingServer: !process.env.CI,
  },
});

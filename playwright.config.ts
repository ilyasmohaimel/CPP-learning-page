import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/journeys.spec.ts", "**/browser.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 10000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(existsSync("/usr/bin/chromium")
        ? { executablePath: "/usr/bin/chromium" }
        : {}),
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    },
  },
  webServer: {
    command: "node --import tsx scripts/test-server.ts",
    url: "http://127.0.0.1:3100/api/health",
    timeout: 30000,
    reuseExistingServer: false,
  },
});

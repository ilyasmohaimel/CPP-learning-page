import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: "**/multi-user.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:3114" },
  webServer: {
    command:
      "CFORGE_TEST_PUBLIC_REGISTRATION=true CFORGE_TEST_PORT=3114 node --import tsx scripts/test-server.ts",
    url: "http://127.0.0.1:3114/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
  timeout: 60000,
});

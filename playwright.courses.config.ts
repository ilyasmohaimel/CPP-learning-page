import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: "**/courses.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:3116" },
  webServer: {
    command:
      "CFORGE_TEST_PUBLIC_REGISTRATION=true CFORGE_TEST_PORT=3116 node --import tsx scripts/test-server.ts",
    url: "http://127.0.0.1:3116/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});

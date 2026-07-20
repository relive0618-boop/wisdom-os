import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", trace: "off", ...devices["Desktop Chrome"] },
  webServer: { command: "pnpm start --hostname localhost", url: "http://localhost:3000", reuseExistingServer: false, timeout: 120_000 },
});

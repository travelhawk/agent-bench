import { existsSync } from "node:fs";
import { defineConfig, devices } from "playwright/test";

const chromePathCandidates = [
  process.env.CHROME_BIN,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome"
].filter((entry): entry is string => Boolean(entry));

const chromeExecutablePath = chromePathCandidates.find((candidate) => existsSync(candidate));

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    launchOptions: chromeExecutablePath ? { executablePath: chromeExecutablePath } : undefined
  },
  webServer: {
    command: "pnpm ui",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});

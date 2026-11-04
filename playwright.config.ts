import { defineConfig } from "@playwright/test";

// Use an already running app. Never start a server or load project secrets here.
const baseURL = process.env.MOONSHOT_E2E_URL ?? "http://127.0.0.1:4177/github-factory/";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseURL).hostname)) {
  throw new Error("Synthetic UI tests require a loopback MOONSHOT_E2E_URL.");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: "./artifacts/playwright/results",
  reporter: [["list"], ["html", { outputFolder: "./artifacts/playwright/report", open: "never" }]],
  use: {
    baseURL,
    browserName: "chromium",
    launchOptions: process.env.MOONSHOT_CHROME_PATH ? { executablePath: process.env.MOONSHOT_CHROME_PATH } : {},
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});

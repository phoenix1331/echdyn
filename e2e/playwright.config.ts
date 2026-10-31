import { defineConfig, devices } from "@playwright/test";

// Runs inside the playwright container of the end-to-end stack (`make e2e`), which reaches
// the app by its service name
export default defineConfig({
  testDir: ".",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  // The dev server compiles each route on its first request
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "report", open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://web:8000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

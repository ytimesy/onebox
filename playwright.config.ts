import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.ONEBOX_TEST_URL ?? "http://127.0.0.1:4320";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 1000 },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1280, height: 1000 },
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1280, height: 1000 },
      },
    },
  ],
  webServer: process.env.ONEBOX_TEST_URL
    ? undefined
    : {
        command: "npm run dev -- --port 4320",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 30000,
      },
});

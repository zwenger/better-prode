import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration.
 * Projects:
 *   - chromium-desktop (1280×720)
 *   - chromium-mobile  (375×812 — iPhone SE viewport, thumb-friendly UX target)
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL: process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["iPhone SE"],
        viewport: { width: 375, height: 812 },
      },
    },
  ],

  // Start dev server before running tests
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env["CI"],
    timeout: 120 * 1000,
  },
});

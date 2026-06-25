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
    baseURL: process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:4173",
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
        // Use Chromium with a mobile viewport instead of WebKit/Safari
        // to avoid requiring the webkit browser installation.
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],

  // Start the server before running tests.
  // We use `vite preview` (serving the production build) instead of `vite dev`
  // because @cloudflare/vite-plugin's SSR dep-optimization in dev mode fails on
  // TanStack Start package import maps (#tanstack-router-entry etc.) — tracked
  // as a known issue with rolldown + @tanstack/start-server-core package imports.
  // Preview uses the already-built output without dep-opt and is fully functional.
  //
  // scripts/e2e-server.sh writes .dev.vars so Miniflare picks up E2E env vars,
  // builds the app, then starts vite preview on port 4173.
  webServer: {
    command: "bash scripts/e2e-server.sh",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env["CI"],
    timeout: 180 * 1000,
  },
});

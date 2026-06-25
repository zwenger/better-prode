import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest configuration with three projects:
 *   - unit:    in-process Node environment (domain, utils, adapters)
 *   - workers: Cloudflare Workers runtime via @cloudflare/vitest-pool-workers
 *   - e2e:     Playwright (configured via playwright.config.ts)
 */
export default defineConfig({
  resolve: {
    alias: {
      "#": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    projects: [
      // Project 1: unit tests — pure functions, adapters, domain logic
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/workers/**/*.test.ts", "node_modules/**"],
          environment: "node",
          globals: true,
          coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            thresholds: {
              lines: 80,
              functions: 80,
              branches: 80,
              statements: 80,
            },
          },
          resolve: {
            alias: {
              "#": path.resolve(__dirname, "./src"),
            },
          },
        },
      },

      // Project 2: workers tests — real workerd runtime (Durable Objects, KV, etc.)
      {
        test: {
          name: "workers",
          include: ["src/workers/**/*.test.ts"],
          pool: "@cloudflare/vitest-pool-workers",
          poolOptions: {
            workers: {
              wrangler: { configPath: "./wrangler.jsonc" },
            },
          },
        },
      },
    ],
  },
});

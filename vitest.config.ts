import { defineConfig, defineProject } from "vitest/config";
import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import path from "node:path";

const alias = {
  "#": path.resolve(__dirname, "./src"),
};

/**
 * Vitest configuration with two test projects:
 *   unit    — in-process Node environment (domain, utils, adapters)
 *   workers — Cloudflare Workers runtime via @cloudflare/vitest-pool-workers
 *
 * Coverage thresholds: 80% minimum across all metrics.
 * E2E tests run via Playwright (playwright.config.ts), not Vitest.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    // Root-level coverage applies to the unit project
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/domain/**", "src/adapters/**", "src/infra/**"],
      exclude: ["src/workers/**", "src/**/*.test.ts", "src/**/__tests__/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    projects: [
      // Project 1: unit tests — pure domain logic, adapters
      defineProject({
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/workers/**/*.test.ts", "node_modules/**"],
          environment: "node",
          globals: true,
        },
        resolve: { alias },
      }),

      // Project 2: workers runtime tests — Durable Objects, KV, workerd
      defineProject({
        test: {
          name: "workers",
          include: ["src/workers/**/*.test.ts"],
          pool: cloudflarePool({
            wrangler: { configPath: "./wrangler.jsonc" },
          }),
        },
        resolve: { alias },
      }),
    ],
  },
});

import { defineConfig, defineProject } from "vitest/config";
import { cloudflarePool, cloudflareTest } from "@cloudflare/vitest-pool-workers";
import path from "node:path";

const alias = {
  "#": path.resolve(__dirname, "./src"),
};

const workersPoolOptions = {
  // main exports MatchDO so the MATCH_DO binding resolves in tests
  main: "./src/workers/worker-entry.ts",
  wrangler: { configPath: "./wrangler.jsonc" },
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
      // The unit-project coverage gate guards the DOMAIN core (pure business
      // logic: scoring, lock, validation, access rules). Infra glue (db client,
      // kysely dialect, auth config) and UI/routes are exercised by the
      // integration, workers, and E2E layers, not unit coverage. Test doubles
      // (__stubs__) and test files are not production code.
      include: ["src/domain/**"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/__tests__/**",
        "src/**/__stubs__/**",
      ],
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
        plugins: [cloudflareTest(workersPoolOptions)],
        test: {
          name: "workers",
          include: ["src/workers/**/*.test.ts"],
          pool: cloudflarePool(workersPoolOptions),
        },
        resolve: { alias },
      }),
    ],
  },
});

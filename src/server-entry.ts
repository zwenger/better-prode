/**
 * Server entry point for Cloudflare Workers.
 *
 * This file wraps @tanstack/react-start/server-entry to provide the
 * #tanstack-router-entry and #tanstack-start-entry package imports from
 * the app's own package.json (defined in the "imports" field), making them
 * visible to rolldown's dep-optimization pass.
 *
 * Why this file exists:
 * @cloudflare/vite-plugin runs rolldown dep-optimization starting from
 * wrangler.jsonc main. The default (@tanstack/react-start/server-entry) chains
 * to @tanstack/start-server-core, which uses #-prefixed package import maps
 * that rolldown resolves from the *importer* package's package.json. Since
 * @tanstack/start-server-core doesn't define #tanstack-router-entry in its own
 * package.json, rolldown fails during dep-opt with "Package import specifier
 * is not defined".
 *
 * Using this app-level file as wrangler main ensures rolldown starts bundling
 * from a file in our package, where our package.json#imports defines both
 * #tanstack-router-entry and #tanstack-start-entry. Node's packageImportsResolve
 * then finds them correctly.
 *
 * Custom routes handled here (before TanStack Start):
 *   POST /api/test/session — test-only auth bypass endpoint (E2E Playwright).
 *     S1: EXCLUDED from the production bundle via VITE_TEST_AUTH_ENABLED guard.
 *     Only included when `vite build --mode e2e` sets VITE_TEST_AUTH_ENABLED=true
 *     (see scripts/e2e-server.sh and .env.e2e).
 *     Defense-in-depth: also gated by TEST_AUTH_BYPASS=true at runtime.
 */
import {
  createServerEntry,
  default as startEntry,
} from "@tanstack/react-start/server-entry";

// S1: Build-time guard — VITE_TEST_AUTH_ENABLED is only true in e2e builds
// (`vite build --mode e2e`). In production builds (`vite build` or `vite build --mode production`),
// this constant is false and Rolldown/Rollup dead-code-eliminates the entire
// branch plus the imported module, making it impossible to reach in prod.
//
// Defense-in-depth layers:
//   1. Build-time: VITE_TEST_AUTH_ENABLED=false → tree-shaken, import eliminated
//   2. Runtime: TEST_AUTH_BYPASS=true env-var check inside handleTestSession
const TEST_AUTH_ENABLED = import.meta.env.VITE_TEST_AUTH_ENABLED === "true";

const handleTestSession = TEST_AUTH_ENABLED
  ? (await import("./routes/api/test/-session")).handleTestSession
  : null;

export default createServerEntry({
  fetch(request) {
    const url = new URL(request.url);

    // Intercept the test-only auth bypass endpoint.
    // Only reachable in e2e builds where handleTestSession was included.
    if (
      handleTestSession !== null &&
      url.pathname === "/api/test/session" &&
      request.method === "POST"
    ) {
      return handleTestSession(request);
    }

    return startEntry.fetch(request);
  },
});

export { MatchDO } from "./workers/match-do";

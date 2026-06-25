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
 *     S1: ONLY active in non-production builds (import.meta.env.DEV guard).
 *     Also gated by TEST_AUTH_BYPASS=true at runtime for defense-in-depth.
 *     MUST NOT be deployed to production — the build-time guard ensures
 *     tree-shaking eliminates all bypass code from the prod bundle.
 */
import {
  createServerEntry,
  default as startEntry,
} from "@tanstack/react-start/server-entry";

// S1: Import the test-auth handler only in non-production builds.
// import.meta.env.DEV is `true` during `vite dev` and Vitest, `false` during
// `vite build` for production. Rolldown/Rollup dead-code-eliminates the entire
// branch (and the imported module) when DEV=false, so the bypass handler is
// completely absent from the production bundle.
//
// Defense-in-depth layers:
//   1. Build-time: this DEV guard → tree-shaken in prod, import eliminated
//   2. Runtime: TEST_AUTH_BYPASS=true env-var check inside handleTestSession
const handleTestSession = import.meta.env.DEV
  // Dynamic import keeps the module out of the initial bundle even in dev builds
  // when this path is not taken at startup. In dev it is evaluated lazily.
  ? (await import("./routes/api/test/session")).handleTestSession
  : null;

export default createServerEntry({
  fetch(request) {
    const url = new URL(request.url);

    // Intercept the test-only auth bypass endpoint.
    // Guard: only active when handleTestSession was loaded (non-prod builds)
    // AND TEST_AUTH_BYPASS=true at runtime.
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

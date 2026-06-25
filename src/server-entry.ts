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
 *     Only active when TEST_AUTH_BYPASS=true. MUST NOT be deployed to production.
 */
import {
  createServerEntry,
  default as startEntry,
} from "@tanstack/react-start/server-entry";
import { handleTestSession } from "./routes/api/test/session";

export default createServerEntry({
  fetch(request) {
    const url = new URL(request.url);

    // Intercept the test-only auth bypass endpoint.
    // SECURITY: Only available when TEST_AUTH_BYPASS=true.
    if (url.pathname === "/api/test/session" && request.method === "POST") {
      return handleTestSession(request);
    }

    return startEntry.fetch(request);
  },
});

export { MatchDO } from "./workers/match-do";

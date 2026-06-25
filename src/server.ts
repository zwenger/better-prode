/**
 * src/server.ts — the Cloudflare Workers entry (referenced by wrangler `main`).
 *
 * Why a custom `main` instead of the official "@tanstack/react-start/server-entry":
 * pointing wrangler `main` at the package entry currently does NOT pick up a
 * project-level server entry, so our Durable Object export and fetch
 * interception would be dropped from the worker bundle
 * (https://github.com/cloudflare/workers-sdk/issues/11100). Using this file as
 * `main` is the working way to:
 *   - export the MatchDO Durable Object class (required by the MATCH_DO binding)
 *   - intercept the test-only auth bypass endpoint in E2E builds
 * All real request handling is delegated to the official handler below.
 */
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

// S1: build-time guard — VITE_TEST_AUTH_ENABLED is only true in e2e builds
// (`npm run build:e2e`). In production builds the constant is false, so the
// branch and the dynamic import are dead-code-eliminated and the bypass cannot
// exist in the prod bundle. Defense-in-depth: also runtime-gated inside the
// handler by TEST_AUTH_BYPASS.
const TEST_AUTH_ENABLED = import.meta.env.VITE_TEST_AUTH_ENABLED === "true";

const handleTestSession = TEST_AUTH_ENABLED
  ? (await import("./routes/api/test/-session")).handleTestSession
  : null;

export default createServerEntry({
  fetch(request) {
    if (handleTestSession !== null) {
      const url = new URL(request.url);
      if (url.pathname === "/api/test/session" && request.method === "POST") {
        return handleTestSession(request);
      }
    }
    return handler.fetch(request);
  },
});

export { MatchDO } from "./workers/match-do";

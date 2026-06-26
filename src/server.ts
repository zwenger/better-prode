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
 *   - mount Better Auth's handler on /api/auth/*  (sign-in, OAuth callback,
 *     get-session, sign-out) — TanStack Start v1 has no API-file-route primitive
 *     that mounts an arbitrary fetch handler at a path, so we do it here
 *   - intercept the test-only auth bypass endpoint in E2E builds
 * All other requests are delegated to the official TanStack handler below.
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

const handleResetDb = TEST_AUTH_ENABLED
  ? (await import("./routes/api/test/-reset-db")).handleResetDb
  : null;

// Push subscription raw HTTP handlers — always available (real application
// endpoints, not test-only). Exposed here so Playwright can POST to them
// directly without TanStack server-fn RPC path discovery.
const { handlePushSubscribe, handlePushUnsubscribe } = await import(
  "./routes/api/push/-push-http"
);

// Prediction submit raw HTTP handler — always available.
const { handleSubmitPrediction } = await import(
  "./routes/api/predictions/-submit-http"
);

export default createServerEntry({
  async fetch(request) {
    const url = new URL(request.url);

    // Better Auth owns all of /api/auth/* (sign-in/social, callback/google,
    // get-session, sign-out, ...). Its handler is a standard fetch handler.
    // Imported lazily so the auth module (DB client + Better Auth init) only
    // loads when an auth request actually arrives — keeps unrelated routes
    // (e.g. the home page) independent of auth/env availability.
    if (url.pathname.startsWith("/api/auth/")) {
      const { auth } = await import("./infra/auth/auth");
      return auth.handler(request);
    }

    // Test-only auth bypass (e2e builds only).
    if (
      handleTestSession !== null &&
      url.pathname === "/api/test/session" &&
      request.method === "POST"
    ) {
      return handleTestSession(request);
    }

    // Test-only DB reset (e2e builds only).
    if (
      handleResetDb !== null &&
      url.pathname === "/api/test/reset-db" &&
      request.method === "POST"
    ) {
      return handleResetDb(request);
    }

    // Push subscription raw HTTP endpoints (real app endpoints, not test-only).
    if (url.pathname === "/api/push/subscribe" && request.method === "POST") {
      return handlePushSubscribe(request);
    }
    if (url.pathname === "/api/push/unsubscribe" && request.method === "POST") {
      return handlePushUnsubscribe(request);
    }

    // Prediction submit raw HTTP endpoint (real app endpoint, not test-only).
    if (url.pathname === "/api/predictions/submit" && request.method === "POST") {
      return handleSubmitPrediction(request);
    }

    return handler.fetch(request);
  },
});

export { MatchDO } from "./workers/match-do";

import { createAPIFileRoute } from "@tanstack/react-start/api";
import { auth } from "#/infra/auth/auth";

/**
 * Better Auth catch-all route.
 * Handles all auth endpoints: /api/auth/*, including:
 *   GET  /api/auth/callback/google
 *   POST /api/auth/sign-in/social
 *   POST /api/auth/sign-out
 *   GET  /api/auth/get-session
 */
export const APIRoute = createAPIFileRoute("/api/auth/$")({
  GET: ({ request }) => auth.handler(request),
  POST: ({ request }) => auth.handler(request),
});

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";

/**
 * Better Auth catch-all handler.
 *
 * These server functions proxy /api/auth/* requests to Better Auth.
 * Handles: /api/auth/callback/google, sign-in, sign-out, get-session
 */
export const handleAuthGet = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = getRequest();
    return auth.handler(request);
  }
);

export const handleAuthPost = createServerFn({ method: "POST" }).handler(
  async () => {
    const request = getRequest();
    return auth.handler(request);
  }
);

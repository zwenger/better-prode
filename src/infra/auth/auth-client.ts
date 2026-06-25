import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client. With no baseURL it uses the current origin,
 * so it works on localhost and on the deployed Worker without configuration.
 *
 * Usage: authClient.signIn.social({ provider: "google", callbackURL: "/" })
 */
export const authClient = createAuthClient();

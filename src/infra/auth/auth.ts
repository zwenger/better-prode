import { betterAuth } from "better-auth";
import { getDbClient } from "#/infra/db/client";

/**
 * Better Auth configuration — Google OAuth provider.
 *
 * Required environment variables:
 *   BETTER_AUTH_SECRET      — random 32+ char string (signs sessions)
 *   GOOGLE_CLIENT_ID        — from Google Cloud Console OAuth 2.0 credentials
 *   GOOGLE_CLIENT_SECRET    — from Google Cloud Console OAuth 2.0 credentials
 *
 * OAuth callback URL: /api/auth/callback/google
 * (registered in Google Cloud Console as an authorized redirect URI)
 */
export const auth = betterAuth({
  secret: process.env["BETTER_AUTH_SECRET"],
  database: {
    // Better Auth will use its own session/account tables alongside ours.
    // It receives the same libSQL client.
    // @ts-expect-error — Better Auth accepts libSQL client but types may lag
    db: getDbClient(),
    type: "sqlite",
  },
  socialProviders: {
    google: {
      clientId: process.env["GOOGLE_CLIENT_ID"] ?? "",
      clientSecret: process.env["GOOGLE_CLIENT_SECRET"] ?? "",
    },
  },
  emailAndPassword: {
    enabled: false,
  },
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;

import { betterAuth } from "better-auth";
import { createDbClient } from "#/infra/db/client";

/**
 * Better Auth configuration — Google OAuth provider.
 *
 * Required environment variables:
 *   BETTER_AUTH_SECRET      — random 32+ char string (signs sessions)
 *   GOOGLE_CLIENT_ID        — from Google Cloud Console OAuth 2.0 credentials
 *   GOOGLE_CLIENT_SECRET    — from Google Cloud Console OAuth 2.0 credentials
 *
 * OAuth callback URL: /api/auth/callback/google
 * (register this in Google Cloud Console as an authorized redirect URI)
 *
 * Better Auth auto-creates its own session/account tables alongside ours.
 * It uses Kysely's SqliteDatabase dialect under the hood — the @libsql/client
 * is compatible with the Kysely SQLite interface Better Auth expects.
 */
export const auth = betterAuth({
  secret: process.env["BETTER_AUTH_SECRET"],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: createDbClient() as any,
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

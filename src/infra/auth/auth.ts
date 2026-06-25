import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "#/infra/db/client";
import * as schema from "#/infra/db/schema";

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
 * Schema mapping: Better Auth looks up model names ("user", "session", "account",
 * "verification") directly from the schema object. Our schema exports match
 * those names (user, session, account, verification).
 *
 * camelCase: true because our auth table columns use camelCase (createdAt,
 * updatedAt, emailVerified, etc.) matching the live DB schema in 0001+0002.
 */
export const auth = betterAuth({
  secret: process.env["BETTER_AUTH_SECRET"],
  // baseURL is required for OAuth callbacks and redirects to work correctly.
  // Set BETTER_AUTH_URL=http://localhost:3000 in .dev.vars for local dev,
  // and to your deployed Workers origin in production.
  baseURL: process.env["BETTER_AUTH_URL"],

  database: drizzleAdapter(getDb(), {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
    camelCase: true,
  }),
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

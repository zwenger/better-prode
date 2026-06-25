/**
 * Test-only Better Auth instance with testUtils plugin.
 *
 * Used by /api/test/session to mint sessions for E2E tests.
 * NEVER import this in production code.
 *
 * Spec (testability): test auth bypass for Playwright E2E.
 */

import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "#/infra/db/client";
import * as schema from "#/infra/db/schema";

export const testAuth = betterAuth({
  secret: process.env["BETTER_AUTH_SECRET"],
  // Keep baseURL consistent with the production auth instance.
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
  plugins: [testUtils()],
});

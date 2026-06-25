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
import { Kysely } from "kysely";
import { createDbClient } from "#/infra/db/client";
import { LibsqlDialect } from "#/infra/db/kysely-libsql-dialect";

const dbClient = createDbClient();
const kyselyDb = new Kysely({ dialect: new LibsqlDialect({ client: dbClient }) });

export const testAuth = betterAuth({
  secret: process.env["BETTER_AUTH_SECRET"],
  database: { db: kyselyDb, type: "sqlite" as const },
  socialProviders: {
    google: {
      clientId: process.env["GOOGLE_CLIENT_ID"] ?? "",
      clientSecret: process.env["GOOGLE_CLIENT_SECRET"] ?? "",
    },
  },
  plugins: [testUtils()],
});

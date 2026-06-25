/**
 * POST /api/test/session
 *
 * Test-only endpoint: mints a Better Auth session for a given user ID.
 * Used by the Playwright E2E auth-bypass helper to skip Google OAuth.
 *
 * SECURITY: Only available when TEST_AUTH_BYPASS=true.
 * This endpoint MUST NOT be deployed to production.
 *
 * Spec (testability): test auth bypass for Playwright E2E.
 */

import { createServerFn } from "@tanstack/react-start";
import { getDbClient } from "#/infra/db/client";
import { auth } from "#/infra/auth/auth";

export interface TestSessionInput {
  userId: string;
  email: string;
  name: string;
}

export const createTestSession = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as TestSessionInput)
  .handler(async ({ data }) => {
    if (process.env["TEST_AUTH_BYPASS"] !== "true") {
      throw new Error("Test auth bypass is not enabled");
    }

    const db = getDbClient();
    const now = new Date().toISOString();

    // Upsert test user into our user table
    await db.execute({
      sql: `INSERT INTO "user"(id, email, name, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
      args: [data.userId, data.email, data.name, now],
    });

    // Create a Better Auth session for this user
    // Better Auth exposes createSession for programmatic session creation
    const session = await (auth as any).api.createSession({
      userId: data.userId,
    });

    return { success: true, sessionToken: session?.token };
  });

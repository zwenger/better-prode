/**
 * POST /api/test/reset-db
 *
 * Test-only endpoint: truncates volatile tables and reseeds from e2e-fixture.sql
 * so each test starts from a known clean state.
 *
 * Volatile tables (those that accumulate test data):
 *   - prediction      (tests submit predictions)
 *   - push_subscription (reminder tests subscribe/unsubscribe)
 *   - invitation      (groups tests generate invite links)
 *   - session / account (Better Auth sessions created per test)
 *
 * Non-volatile tables (seeded once per server start, not touched by tests):
 *   - tournament, team, match, group, group_membership, user
 *
 * SECURITY: Only available when TEST_AUTH_BYPASS=true.
 * This endpoint MUST NOT be deployed to production.
 *
 * Registration: handled in src/server.ts via the fetch interceptor.
 */

import { sql } from "drizzle-orm";
import { getDb } from "#/infra/db/client";

/**
 * Raw HTTP handler for POST /api/test/reset-db.
 * Called by the Worker entry in src/server.ts.
 *
 * Body (optional): { userId?: string } — when provided, only clears predictions
 * and push subscriptions for that specific user. Otherwise, clears all rows in
 * volatile tables. User-scoped reset prevents cross-project parallel test races
 * when both chromium-desktop and chromium-mobile run the same test simultaneously.
 *
 * SECURITY: Only available when TEST_AUTH_BYPASS=true.
 */
export async function handleResetDb(request: Request): Promise<Response> {
  const host = new URL(request.url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    return Response.json({ error: "Not available" }, { status: 403 });
  }

  if (process.env["TEST_AUTH_BYPASS"] !== "true") {
    return Response.json(
      { error: "Test auth bypass is not enabled" },
      { status: 403 }
    );
  }

  const db = getDb();

  // Parse optional { userId } from body
  let userId: string | undefined;
  try {
    const raw: unknown = await request.json();
    const body = raw as Record<string, unknown>;
    if (typeof body["userId"] === "string") {
      userId = body["userId"];
    }
  } catch {
    // No body or invalid JSON — perform global reset
  }

  if (userId) {
    // User-scoped reset: only clear volatile data for this specific user.
    // Prevents parallel test runs (chromium-desktop + chromium-mobile) from
    // clearing each other's predictions when using the same match.
    await db.run(sql`DELETE FROM prediction WHERE user_id = ${userId}`);
    await db.run(sql`DELETE FROM push_subscription WHERE user_id = ${userId}`);
    // Invitations are group-scoped, not user-scoped — clear all (rare conflict risk)
    await db.run(sql`DELETE FROM invitation`);
    return Response.json({ ok: true, reset: ["prediction(user)", "push_subscription(user)", "invitation"], userId });
  }

  // Global reset: truncate all volatile tables.
  // Do NOT clear session/account — sessions accumulating is harmless and
  // clearing them causes race conditions when parallel tests create sessions.
  await db.run(sql`DELETE FROM prediction`);
  await db.run(sql`DELETE FROM push_subscription`);
  await db.run(sql`DELETE FROM invitation`);

  return Response.json({ ok: true, reset: ["prediction", "push_subscription", "invitation"] });
}

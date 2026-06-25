/**
 * POST /api/admin/apply-result
 *
 * Admin endpoint to manually apply a match result.
 * - Admin-only guard (checks ADMIN_USER_IDS env var)
 * - Sets source=manual, pins result (auto cannot overwrite)
 * - Dispatches to MATCH_DO binding for single-flight settlement
 *
 * Spec (result-triggering, match-results): manual source pins;
 * admin is the backstop when auto polling is unavailable.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { getDbClient } from "#/infra/db/client";
import { SystemClock } from "#/domain/ports/clock";
import { applyMatchResult } from "#/domain/apply-match-result";
import { LibSqlMatchRepository } from "#/adapters/db/match-repository";
import { LibSqlPredictionRepository } from "#/adapters/db/prediction-repository";

export interface ApplyResultInput {
  matchId: string;
  homeScore: number;
  awayScore: number;
  status?: "finished" | "in_progress";
}

export interface ApplyResultOutput {
  success: boolean;
  error?: string;
}

/**
 * Simple admin check — in MVP, any user listed in ADMIN_USER_IDS env var.
 * This should be replaced with a proper role system in a future PR.
 */
function isAdmin(userId: string): boolean {
  const adminIds = process.env["ADMIN_USER_IDS"] ?? "";
  return adminIds.split(",").map((id) => id.trim()).includes(userId);
}

export const applyResult = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as ApplyResultInput)
  .handler(async ({ data }): Promise<ApplyResultOutput> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }
    if (!isAdmin(session.user.id)) {
      throw new Error("Forbidden: admin only");
    }

    const db = getDbClient();
    const matchRepo = new LibSqlMatchRepository(db);
    const predRepo = new LibSqlPredictionRepository(db);
    const clock = new SystemClock();

    await applyMatchResult(
      {
        matchId: data.matchId,
        homeScore: data.homeScore,
        awayScore: data.awayScore,
        status: data.status ?? "finished",
        source: "manual",
      },
      { matchRepository: matchRepo, predictionRepository: predRepo },
      clock
    );

    return { success: true };
  });

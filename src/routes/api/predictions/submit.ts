/**
 * POST /api/predictions/submit
 *
 * Submits or updates a prediction for a match.
 * - Validates auth session
 * - Checks server-side lock (kickoff − 5min, using SystemClock)
 * - Returns 423 if locked
 * - Upserts prediction (UNIQUE(user_id, match_id))
 *
 * Spec (predictions): server lock is authoritative — rejects even crafted requests.
 * Design: Clock injected via SystemClock in production; FakeClock in tests.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { getDbClient } from "#/infra/db/client";
import { SystemClock } from "#/domain/ports/clock";
import { isLocked } from "#/domain/lock";
import { LibSqlMatchRepository } from "#/adapters/db/match-repository";
import { LibSqlPredictionRepository } from "#/adapters/db/prediction-repository";

export interface SubmitPredictionInput {
  matchId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface SubmitPredictionOutput {
  success: boolean;
  predictionId: string;
  locked?: boolean;
  error?: string;
}

export const submitPrediction = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as SubmitPredictionInput)
  .handler(async ({ data }): Promise<SubmitPredictionOutput> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const db = getDbClient();
    const matchRepo = new LibSqlMatchRepository(db);
    const predRepo = new LibSqlPredictionRepository(db);

    const match = await matchRepo.getById(data.matchId);
    if (!match) {
      throw new Error(`Match not found: ${data.matchId}`);
    }

    const clock = new SystemClock();
    if (isLocked(match.kickoffUtc, clock)) {
      return { success: false, locked: true, predictionId: "", error: "match_locked" };
    }

    const prediction = await predRepo.upsert({
      userId: session.user.id,
      matchId: data.matchId,
      homeGoals: data.homeGoals,
      awayGoals: data.awayGoals,
    });

    return { success: true, predictionId: prediction.id };
  });

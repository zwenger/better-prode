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
import { validateGoals } from "#/domain/validate-goals";
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
  .validator((data: unknown): SubmitPredictionInput => {
    // W2: reject invalid goal values with HTTP 400 before touching the DB.
    const raw = data as Record<string, unknown>;
    const goalsError = validateGoals(raw["homeGoals"], raw["awayGoals"]);
    if (goalsError) {
      throw Object.assign(new Error(goalsError), { status: 400 });
    }
    return data as SubmitPredictionInput;
  })
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
      // S2: return HTTP 422 with reason match_locked per spec (not 200)
      throw Object.assign(new Error("match_locked"), { status: 422 });
    }

    const prediction = await predRepo.upsert({
      userId: session.user.id,
      matchId: data.matchId,
      homeGoals: data.homeGoals,
      awayGoals: data.awayGoals,
    });

    return { success: true, predictionId: prediction.id };
  });

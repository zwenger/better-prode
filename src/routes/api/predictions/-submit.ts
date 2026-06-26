/**
 * POST /api/predictions/submit
 * POST /api/predictions/submit-batch
 *
 * Single and batch prediction submission server functions.
 * - Validates goal inputs (HTTP 400 on invalid)
 * - Validates auth session (Unauthorized if none)
 * - Delegates lock-check + upsert to submitPredictionCore (domain)
 *
 * The persistence + lock logic lives in `#/domain/submit-prediction` so it can
 * be integration-tested against a real in-memory libSQL without the auth/request
 * plumbing (which initializes the Better Auth + DB client at module load).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { SystemClock } from "#/domain/ports/clock";
import { validateGoals } from "#/domain/validate-goals";
import { DrizzleMatchRepository } from "#/adapters/db/match-repository";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import {
  submitPredictionCore,
} from "#/domain/submit-prediction";
import type { SubmitPredictionInput, SubmitPredictionOutput } from "#/domain/submit-prediction";
import type { PerMatchResult } from "#/app/aggregate-batch-results";

export type { SubmitPredictionInput, SubmitPredictionOutput };

export interface BatchPredictionInput {
  matchId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface BatchSubmitResult {
  results: Record<string, PerMatchResult>;
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

    const db = getDb();
    return submitPredictionCore({
      userId: session.user.id,
      input: data,
      matchRepo: new DrizzleMatchRepository(db),
      predRepo: new DrizzlePredictionRepository(db),
      clock: new SystemClock(),
    });
  });

/**
 * Batch prediction submission — accepts an array of {matchId, homeGoals, awayGoals}.
 * Runs submitPredictionCore for each via Promise.allSettled so partial failure
 * (e.g. one match locked) does not abort the remaining submissions.
 *
 * Returns per-match status: "saved" | "locked" | "error".
 * 422 from submitPredictionCore → "locked"; any other throw → "error".
 */
export const submitBatchPredictions = createServerFn({ method: "POST" })
  .validator((data: unknown): { predictions: BatchPredictionInput[] } => {
    const raw = data as Record<string, unknown>;
    if (!Array.isArray(raw["predictions"])) {
      throw Object.assign(new Error("predictions must be an array"), { status: 400 });
    }
    return data as { predictions: BatchPredictionInput[] };
  })
  .handler(async ({ data }): Promise<BatchSubmitResult> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const db = getDb();
    const matchRepo = new DrizzleMatchRepository(db);
    const predRepo = new DrizzlePredictionRepository(db);
    const clock = new SystemClock();
    const userId = session.user.id;

    const settled = await Promise.allSettled(
      data.predictions.map((p) =>
        submitPredictionCore({
          userId,
          input: { matchId: p.matchId, homeGoals: p.homeGoals, awayGoals: p.awayGoals },
          matchRepo,
          predRepo,
          clock,
        })
      )
    );

    const results: Record<string, PerMatchResult> = {};
    for (const [i, outcome] of settled.entries()) {
      const matchId = data.predictions[i].matchId;
      if (outcome.status === "fulfilled") {
        results[matchId] = { status: "saved" };
      } else {
        const err = outcome.reason as { status?: number; message?: string };
        if (err.status === 422) {
          results[matchId] = { status: "locked", message: "match_locked" };
        } else {
          results[matchId] = { status: "error", message: err.message ?? "Unknown error" };
        }
      }
    }

    return { results };
  });

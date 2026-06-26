/**
 * POST /api/predictions/submit
 *
 * Submits or updates a prediction for a match.
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
  submitPredictionCore
  
  
} from "#/domain/submit-prediction";
import type {SubmitPredictionInput, SubmitPredictionOutput} from "#/domain/submit-prediction";

export type { SubmitPredictionInput, SubmitPredictionOutput };

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

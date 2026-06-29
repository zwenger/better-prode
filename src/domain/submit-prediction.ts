/**
 * Submit-prediction core logic — pure domain orchestration.
 *
 * Depends ONLY on domain ports (no auth, no DB client, no request plumbing), so
 * it imports cleanly in unit tests and can be exercised against any repository
 * implementation (real in-memory libSQL in tests, Turso in prod).
 *
 * The HTTP/auth handler (src/routes/api/predictions/-submit.ts) resolves the
 * session + concrete repos and delegates here.
 */

import type { Clock } from "#/domain/ports/clock";
import { isLocked } from "#/domain/lock";
import type {
  MatchRepository,
  PredictionRepository,
} from "#/domain/ports/repositories";

export interface SubmitPredictionInput {
  matchId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface SubmitPredictionOutput {
  success: boolean;
  predictionId: string;
  // NOTE: lock is signaled exclusively by throwing { status: 422, message: "match_locked" }.
  // The `locked` field was previously a dead branch — callers that need lock state
  // should catch the 422 throw instead. Kept as an optional field for backward
  // compatibility with existing callers; new code must NOT read this field.
  /** @deprecated Lock is signaled via a 422 throw, not this field. Do not use. */
  locked?: never;
  error?: string;
}

/**
 * Validates the lock and PERSISTS the prediction (upsert) for an authenticated
 * user. Throws `{ message: "match_locked", status: 422 }` if the match is
 * locked, or an error if the match does not exist.
 */
export async function submitPredictionCore(opts: {
  userId: string;
  input: SubmitPredictionInput;
  matchRepo: MatchRepository;
  predRepo: PredictionRepository;
  clock: Clock;
}): Promise<SubmitPredictionOutput> {
  const { userId, input, matchRepo, predRepo, clock } = opts;

  const match = await matchRepo.getById(input.matchId);
  if (!match) {
    throw new Error(`Match not found: ${input.matchId}`);
  }

  // TBD guard (spec: Predictable Gate — Server rejects prediction for TBD match).
  // A match is only predictable when BOTH team IDs are confirmed. This is a
  // security boundary — client-side exclusion from "Para predecir" is not enough.
  if (match.homeTeamId === null || match.awayTeamId === null) {
    throw Object.assign(
      new Error("match_teams_not_confirmed_tbd"),
      { status: 422 }
    );
  }

  if (isLocked(match.kickoffUtc, clock)) {
    // S2: HTTP 422 with reason match_locked per spec.
    throw Object.assign(new Error("match_locked"), { status: 422 });
  }

  const prediction = await predRepo.upsert({
    userId,
    matchId: input.matchId,
    homeGoals: input.homeGoals,
    awayGoals: input.awayGoals,
  });

  return { success: true, predictionId: prediction.id };
}

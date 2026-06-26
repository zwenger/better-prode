/**
 * DuplicatePredictionError — typed domain error for UNIQUE(user_id, match_id)
 * constraint violations on the prediction table.
 *
 * Task 2.4 (GREEN): surfaces the DB unique-violation as a first-class domain
 * error instead of a raw SQL error. Callers can narrow with instanceof.
 *
 * Spec (predictions): "a prediction already exists for (user, match) — second
 * INSERT for the same pair is attempted — DB constraint rejects it."
 *
 * Note: The standard DrizzlePredictionRepository.upsert() uses ON CONFLICT DO UPDATE,
 * so it never throws this error in normal operation. This error is reserved for
 * raw INSERT paths (e.g. future batch inserts) or direct DB access that bypasses
 * the upsert. It is exposed here so adapters can translate SQLite UNIQUE constraint
 * errors into a typed domain boundary error.
 */

export class DuplicatePredictionError extends Error {
  readonly code = "DUPLICATE_PREDICTION" as const;
  readonly userId: string;
  readonly matchId: string;

  constructor(userId: string, matchId: string) {
    super(`Duplicate prediction: user ${userId} already has a prediction for match ${matchId}`);
    this.name = "DuplicatePredictionError";
    this.userId = userId;
    this.matchId = matchId;
  }
}

/**
 * Repository port interfaces — hexagonal boundary.
 *
 * Domain code depends ONLY on these interfaces.
 * Concrete adapters (Turso/libSQL) live in src/adapters/db/.
 *
 * Design decision #1: domain depends on nothing; adapters implement these ports.
 */

import type {
  MatchRecord,
  PredictionRecord,
  MatchStatus,
  ResultSource,
} from "#/domain/apply-match-result";

export type { MatchRecord, PredictionRecord };

/**
 * MatchRepository port — read/write match records.
 */
export interface MatchRepository {
  getById(id: string): Promise<MatchRecord | null>;
  updateResult(
    id: string,
    update: Partial<
      Pick<
        MatchRecord,
        "homeScore" | "awayScore" | "resultSource" | "settledAt" | "status"
      >
    >
  ): Promise<void>;
}

/**
 * PredictionRepository port — read/write prediction records.
 */
export interface PredictionRepository {
  /** Get all predictions for a given match. */
  listByMatch(matchId: string): Promise<PredictionRecord[]>;
  /** Update the stored points for a specific prediction after settlement. */
  updatePoints(predictionId: string, points: number): Promise<void>;
  /**
   * Insert or update a prediction for (userId, matchId).
   * Throws `DUPLICATE_PREDICTION` domain error if the DB UNIQUE constraint
   * fires in an unexpected context (should not happen with upsert).
   */
  upsert(prediction: Omit<PredictionRecord, "id" | "points"> & { id?: string }): Promise<PredictionRecord>;
}

// Re-export types used by adapters
export type { MatchStatus, ResultSource };

/**
 * DrizzlePredictionRepository — implements PredictionRepository port against Turso/libSQL
 * using Drizzle ORM query builder.
 *
 * Replaces the raw SQL LibSqlPredictionRepository.
 * UNIQUE(user_id, match_id) constraint is handled via Drizzle's .onConflictDoUpdate().
 * The leaderboard SUM query preserves the C1 fix: INNER JOIN match on tournament_id
 * so only predictions from the requested tournament are summed, while LEFT JOIN from
 * group_membership ensures zero-point members still appear.
 */

import { eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "#/infra/db/client";
import { prediction as predictionTable } from "#/infra/db/schema";
import type {
  PredictionRepository,
  PredictionRecord,
} from "#/domain/ports/repositories";
import { randomUUID } from "node:crypto";

export interface LeaderboardEntry {
  userId: string;
  totalPoints: number;
}

export class DrizzlePredictionRepository implements PredictionRepository {
  constructor(private readonly db: DrizzleDb) {}

  async listByMatch(matchId: string): Promise<PredictionRecord[]> {
    const rows = await this.db
      .select({
        id: predictionTable.id,
        userId: predictionTable.userId,
        matchId: predictionTable.matchId,
        homeGoals: predictionTable.homeGoals,
        awayGoals: predictionTable.awayGoals,
        points: predictionTable.points,
      })
      .from(predictionTable)
      .where(eq(predictionTable.matchId, matchId));

    return rows.map(this.rowToRecord);
  }

  async updatePoints(predictionId: string, points: number): Promise<void> {
    await this.db
      .update(predictionTable)
      .set({ points })
      .where(eq(predictionTable.id, predictionId));
  }

  async upsert(
    prediction: Omit<PredictionRecord, "id" | "points"> & { id?: string }
  ): Promise<PredictionRecord> {
    const now = new Date().toISOString();
    const id = prediction.id ?? randomUUID();

    // W3 fix: atomic upsert — INSERT ... ON CONFLICT(user_id, match_id) DO UPDATE
    // replaces the non-atomic SELECT-then-INSERT/UPDATE pattern which races under
    // concurrent submissions for the same (user, match).
    await this.db
      .insert(predictionTable)
      .values({
        id,
        userId: prediction.userId,
        matchId: prediction.matchId,
        homeGoals: prediction.homeGoals,
        awayGoals: prediction.awayGoals,
        points: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [predictionTable.userId, predictionTable.matchId],
        set: {
          homeGoals: prediction.homeGoals,
          awayGoals: prediction.awayGoals,
          updatedAt: now,
        },
      });

    // Fetch the persisted row to return the canonical id (may differ from
    // our generated id if a conflict occurred and the original row was kept).
    const rows = await this.db
      .select({ id: predictionTable.id })
      .from(predictionTable)
      .where(
        sql`${predictionTable.userId} = ${prediction.userId} AND ${predictionTable.matchId} = ${prediction.matchId}`
      )
      .limit(1);

    const persistedId = rows[0]?.id ?? id;

    return {
      id: persistedId,
      userId: prediction.userId,
      matchId: prediction.matchId,
      homeGoals: prediction.homeGoals,
      awayGoals: prediction.awayGoals,
      points: null,
    };
  }

  /**
   * Leaderboard SUM query — aggregates stored points per user in a group.
   * Design decision #5: stored points, never re-invokes scoring function.
   *
   * Fix C1: INNER JOIN match on tournament_id so only predictions for matches
   * in the requested tournament are summed. The outer LEFT JOIN from
   * group_membership ensures zero-point members still appear.
   *
   * Equivalent SQL:
   *   SELECT gm.user_id, COALESCE(SUM(p.points), 0) as total_points
   *   FROM group_membership gm
   *   LEFT JOIN (
   *     prediction p
   *     INNER JOIN match m ON m.id = p.match_id AND m.tournament_id = ?
   *   ) ON p.user_id = gm.user_id
   *   WHERE gm.group_id = ?
   *   GROUP BY gm.user_id
   *   ORDER BY total_points DESC
   */
  async getLeaderboard(
    groupId: string,
    tournamentId: string
  ): Promise<LeaderboardEntry[]> {
    // The C1 fix requires a LEFT JOIN of a derived table (prediction INNER JOIN match).
    // Drizzle does not yet support inlined subquery joins as a first-class API, so we
    // use db.all() with a raw SQL template which is still fully parameterized (no string
    // interpolation of user data — groupId and tournamentId are bound as SQL parameters).
    const rows = await this.db.all<{ userId: string; totalPoints: number }>(sql`
      SELECT gm.user_id AS userId, COALESCE(SUM(p.points), 0) AS totalPoints
      FROM group_membership gm
      LEFT JOIN (
        prediction p
        INNER JOIN match m ON m.id = p.match_id AND m.tournament_id = ${tournamentId}
      ) ON p.user_id = gm.user_id
      WHERE gm.group_id = ${groupId}
      GROUP BY gm.user_id
      ORDER BY totalPoints DESC
    `);

    return rows.map((row) => ({
      userId: row.userId,
      totalPoints: Number(row.totalPoints),
    }));
  }

  private rowToRecord(row: {
    id: string;
    userId: string;
    matchId: string;
    homeGoals: number;
    awayGoals: number;
    points: number | null;
  }): PredictionRecord {
    return {
      id: row.id,
      userId: row.userId,
      matchId: row.matchId,
      homeGoals: row.homeGoals,
      awayGoals: row.awayGoals,
      points: row.points,
    };
  }
}

// Keep the old name exported as an alias so existing call sites
// that import LibSqlPredictionRepository continue to compile during migration.
export { DrizzlePredictionRepository as LibSqlPredictionRepository };

/**
 * LibSqlPredictionRepository — implements PredictionRepository port against Turso/libSQL.
 *
 * UNIQUE(user_id, match_id) constraint is handled via INSERT OR REPLACE (upsert).
 * The leaderboard SUM query aggregates stored points — scoring is never re-invoked.
 */

import type { Client } from "@libsql/client";
import type {
  PredictionRepository,
  PredictionRecord,
} from "#/domain/ports/repositories";
import { randomUUID } from "node:crypto";

export interface LeaderboardEntry {
  userId: string;
  totalPoints: number;
}

export class LibSqlPredictionRepository implements PredictionRepository {
  constructor(private readonly db: Client) {}

  async listByMatch(matchId: string): Promise<PredictionRecord[]> {
    const result = await this.db.execute({
      sql: `SELECT id, user_id, match_id, home_goals, away_goals, points
            FROM prediction WHERE match_id = ?`,
      args: [matchId],
    });

    return result.rows.map(this.rowToRecord);
  }

  async updatePoints(predictionId: string, points: number): Promise<void> {
    await this.db.execute({
      sql: `UPDATE prediction SET points = ? WHERE id = ?`,
      args: [points, predictionId],
    });
  }

  async upsert(
    prediction: Omit<PredictionRecord, "id" | "points"> & { id?: string }
  ): Promise<PredictionRecord> {
    const now = new Date().toISOString();
    const id = prediction.id ?? randomUUID();

    // W3 fix: atomic upsert — INSERT ... ON CONFLICT(user_id, match_id) DO UPDATE
    // replaces the non-atomic SELECT-then-INSERT/UPDATE pattern which races under
    // concurrent submissions for the same (user, match).
    await this.db.execute({
      sql: `INSERT INTO prediction(id, user_id, match_id, home_goals, away_goals, points, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
            ON CONFLICT(user_id, match_id)
            DO UPDATE SET home_goals = excluded.home_goals,
                          away_goals = excluded.away_goals,
                          updated_at = excluded.updated_at`,
      args: [
        id,
        prediction.userId,
        prediction.matchId,
        prediction.homeGoals,
        prediction.awayGoals,
        now,
        now,
      ],
    });

    // Fetch the persisted row to return the canonical id (may differ from
    // our generated id if a conflict occurred and the original row was kept).
    const existing = await this.db.execute({
      sql: `SELECT id FROM prediction WHERE user_id = ? AND match_id = ?`,
      args: [prediction.userId, prediction.matchId],
    });
    const persistedId = (existing.rows[0]?.["id"] ?? id) as string;

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
   * SELECT u.id, SUM(p.points) FROM group_membership gm
   *   JOIN prediction p ON p.user_id = gm.user_id
   *   JOIN match m ON m.id = p.match_id
   *   WHERE gm.group_id = ? AND m.tournament_id = ?
   *   GROUP BY gm.user_id
   */
  async getLeaderboard(
    groupId: string,
    tournamentId: string
  ): Promise<LeaderboardEntry[]> {
    // Fix C1: use INNER JOIN + WHERE m.tournament_id = ? so only predictions
    // for matches in the requested tournament are summed.  The previous LEFT JOIN
    // let SUM accumulate points from ALL tournaments for the same user.
    // Members with zero points still appear via the outer LEFT JOIN from gm.
    const result = await this.db.execute({
      sql: `SELECT gm.user_id, COALESCE(SUM(p.points), 0) as total_points
            FROM group_membership gm
            LEFT JOIN (
              prediction p
              INNER JOIN match m ON m.id = p.match_id AND m.tournament_id = ?
            ) ON p.user_id = gm.user_id
            WHERE gm.group_id = ?
            GROUP BY gm.user_id
            ORDER BY total_points DESC`,
      args: [tournamentId, groupId],
    });

    return result.rows.map((row) => ({
      userId: row["user_id"] as string,
      totalPoints: Number(row["total_points"] ?? 0),
    }));
  }

  private rowToRecord(row: Record<string, unknown>): PredictionRecord {
    return {
      id: row["id"] as string,
      userId: row["user_id"] as string,
      matchId: row["match_id"] as string,
      homeGoals: row["home_goals"] as number,
      awayGoals: row["away_goals"] as number,
      points: row["points"] as number | null,
    };
  }
}

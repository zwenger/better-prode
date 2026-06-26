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

export interface LeaderboardWithNamesEntry {
  userId: string;
  displayName: string;
  totalPoints: number;
  plenosCount: number;
}

export interface MemberPredictionEntry {
  predictionId: string;
  predHomeGoals: number;
  predAwayGoals: number;
  points: number | null;
  matchId: string;
  kickoffUtc: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  groupLabel: string | null;
  homeName: string;
  homeCode: string | null;
  awayName: string;
  awayCode: string | null;
}

/**
 * Per-match leaderboard breakdown entry — shows each group member's prediction
 * and points for a single match.  Members who have not predicted have null values.
 *
 * W-4 spec MUST: "users see each group member's points for a specific match."
 */
export interface MatchLeaderboardEntry {
  userId: string;
  homeGoals: number | null;
  awayGoals: number | null;
  points: number | null;
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

  /**
   * Batch lookup of a single user's predictions for a set of matches.
   *
   * Task 4.6: Used by the match-list loader to hydrate PredictableCard initial
   * state, fixing the "saved prediction reverts to 0-0 on reload" bug.
   *
   * Returns a Map<matchId, PredictionRecord> so callers can do O(1) lookup per
   * match without an additional DB round-trip per card.
   *
   * Returns an empty Map when matchIds is empty (no DB query issued).
   */
  async findByUserForMatches(
    userId: string,
    matchIds: string[]
  ): Promise<Map<string, PredictionRecord>> {
    if (matchIds.length === 0) return new Map();

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
      .where(
        sql`${predictionTable.userId} = ${userId} AND ${predictionTable.matchId} IN (${sql.join(matchIds.map((id) => sql`${id}`), sql`, `)})`
      );

    const map = new Map<string, PredictionRecord>();
    for (const row of rows) {
      map.set(row.matchId, this.rowToRecord(row));
    }
    return map;
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

  /**
   * Per-match leaderboard breakdown — returns every group member with their
   * prediction (homeGoals, awayGoals, points) for a specific match.
   *
   * Members who have not submitted a prediction appear with null values
   * (LEFT JOIN guarantee identical to the overall leaderboard query).
   *
   * W-4 spec MUST: "users see each group member's points for a specific match."
   *
   * Equivalent SQL:
   *   SELECT gm.user_id, p.home_goals, p.away_goals, p.points
   *   FROM group_membership gm
   *   LEFT JOIN prediction p ON p.user_id = gm.user_id AND p.match_id = ?
   *   WHERE gm.group_id = ?
   */
  async getMatchLeaderboard(
    groupId: string,
    matchId: string
  ): Promise<MatchLeaderboardEntry[]> {
    const rows = await this.db.all<{
      userId: string;
      homeGoals: number | null;
      awayGoals: number | null;
      points: number | null;
    }>(sql`
      SELECT gm.user_id AS userId, p.home_goals AS homeGoals, p.away_goals AS awayGoals, p.points AS points
      FROM group_membership gm
      LEFT JOIN prediction p ON p.user_id = gm.user_id AND p.match_id = ${matchId}
      WHERE gm.group_id = ${groupId}
    `);

    return rows.map((row) => ({
      userId: row.userId,
      homeGoals: row.homeGoals ?? null,
      awayGoals: row.awayGoals ?? null,
      points: row.points ?? null,
    }));
  }

  async getLeaderboardWithNames(
    groupId: string,
    tournamentId: string
  ): Promise<LeaderboardWithNamesEntry[]> {
    const rows = await this.db.all<{
      userId: string;
      displayName: string;
      totalPoints: number;
      plenosCount: number;
    }>(sql`
      SELECT gm.user_id AS userId,
             u.name AS displayName,
             COALESCE(SUM(p.points), 0) AS totalPoints,
             COUNT(CASE WHEN p.points = 7 THEN 1 END) AS plenosCount
      FROM group_membership gm
      INNER JOIN "user" u ON u.id = gm.user_id
      LEFT JOIN (
        prediction p
        INNER JOIN match m ON m.id = p.match_id AND m.tournament_id = ${tournamentId}
      ) ON p.user_id = gm.user_id
      WHERE gm.group_id = ${groupId}
      GROUP BY gm.user_id, u.name
      ORDER BY totalPoints DESC
    `);

    return rows.map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      totalPoints: Number(row.totalPoints),
      plenosCount: Number(row.plenosCount),
    }));
  }

  async getMemberPredictions(
    memberId: string,
    groupId: string,
    tournamentId: string
  ): Promise<MemberPredictionEntry[]> {
    const rows = await this.db.all<{
      predictionId: string;
      predHomeGoals: number;
      predAwayGoals: number;
      points: number | null;
      matchId: string;
      kickoffUtc: string;
      status: string;
      homeScore: number | null;
      awayScore: number | null;
      groupLabel: string | null;
      homeName: string;
      homeCode: string | null;
      awayName: string;
      awayCode: string | null;
    }>(sql`
      SELECT p.id AS predictionId,
             p.home_goals AS predHomeGoals,
             p.away_goals AS predAwayGoals,
             p.points AS points,
             m.id AS matchId,
             m.kickoff_utc AS kickoffUtc,
             m.status AS status,
             m.home_score AS homeScore,
             m.away_score AS awayScore,
             m.group_label AS groupLabel,
             ht.name AS homeName,
             ht.code AS homeCode,
             at.name AS awayName,
             at.code AS awayCode
      FROM prediction p
      INNER JOIN match m ON m.id = p.match_id AND m.tournament_id = ${tournamentId}
             AND m.status IN ('finished', 'in_progress')
      INNER JOIN team ht ON ht.id = m.home_team_id
      INNER JOIN team at ON at.id = m.away_team_id
      WHERE p.user_id = ${memberId}
        AND EXISTS (
          SELECT 1 FROM group_membership gm2
          WHERE gm2.group_id = ${groupId} AND gm2.user_id = ${memberId}
        )
      ORDER BY m.kickoff_utc DESC
    `);

    return rows.map((row) => ({
      predictionId: row.predictionId,
      predHomeGoals: Number(row.predHomeGoals),
      predAwayGoals: Number(row.predAwayGoals),
      points: row.points !== null ? Number(row.points) : null,
      matchId: row.matchId,
      kickoffUtc: row.kickoffUtc,
      status: row.status,
      homeScore: row.homeScore !== null ? Number(row.homeScore) : null,
      awayScore: row.awayScore !== null ? Number(row.awayScore) : null,
      groupLabel: row.groupLabel,
      homeName: row.homeName,
      homeCode: row.homeCode,
      awayName: row.awayName,
      awayCode: row.awayCode,
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

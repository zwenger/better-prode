/**
 * LibSqlMatchRepository — implements MatchRepository port against Turso/libSQL.
 *
 * All SQL is parameterized (no string interpolation).
 * Column names mirror the schema in db/migrations/0001_init.sql.
 */

import type { Client } from "@libsql/client";
import type {
  MatchRepository,
  MatchRecord,
} from "#/domain/ports/repositories";

export class LibSqlMatchRepository implements MatchRepository {
  constructor(private readonly db: Client) {}

  async getById(id: string): Promise<MatchRecord | null> {
    const result = await this.db.execute({
      sql: `SELECT id, tournament_id, home_team_id, away_team_id,
                   kickoff_utc, status, home_score, away_score,
                   result_source, settled_at, created_at
            FROM match WHERE id = ?`,
      args: [id],
    });

    if (result.rows.length === 0) return null;

    const row = result.rows[0]!;
    return this.rowToRecord(row);
  }

  async updateResult(
    id: string,
    update: Partial<
      Pick<
        MatchRecord,
        "homeScore" | "awayScore" | "resultSource" | "settledAt" | "status"
      >
    >
  ): Promise<void> {
    const setClauses: string[] = [];
    const args: (string | number | null)[] = [];

    if (update.homeScore !== undefined) {
      setClauses.push("home_score = ?");
      args.push(update.homeScore);
    }
    if (update.awayScore !== undefined) {
      setClauses.push("away_score = ?");
      args.push(update.awayScore);
    }
    if (update.resultSource !== undefined) {
      setClauses.push("result_source = ?");
      args.push(update.resultSource);
    }
    if (update.settledAt !== undefined) {
      setClauses.push("settled_at = ?");
      args.push(update.settledAt);
    }
    if (update.status !== undefined) {
      setClauses.push("status = ?");
      args.push(update.status);
    }

    if (setClauses.length === 0) return;

    args.push(id);
    await this.db.execute({
      sql: `UPDATE match SET ${setClauses.join(", ")} WHERE id = ?`,
      args,
    });
  }

  private rowToRecord(row: Record<string, unknown>): MatchRecord {
    return {
      id: row["id"] as string,
      tournamentId: row["tournament_id"] as string,
      homeTeamId: row["home_team_id"] as string,
      awayTeamId: row["away_team_id"] as string,
      kickoffUtc: row["kickoff_utc"] as string,
      status: row["status"] as MatchRecord["status"],
      homeScore: row["home_score"] as number | null,
      awayScore: row["away_score"] as number | null,
      resultSource: row["result_source"] as MatchRecord["resultSource"],
      settledAt: row["settled_at"] as string | null,
    };
  }
}

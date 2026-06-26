/**
 * DrizzleMatchRepository — implements MatchRepository port against Turso/libSQL
 * using Drizzle ORM query builder.
 *
 * Replaces the raw SQL LibSqlMatchRepository.
 * Column names mirror the schema in db/migrations/0001_init.sql.
 */

import { eq, or, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { DrizzleDb } from "#/infra/db/client";
import { match as matchTable, team as teamTable } from "#/infra/db/schema";
import type {
  MatchRepository,
  MatchRecord,
  TeamMatchRow,
} from "#/domain/ports/repositories";

// Re-export so call sites that import TeamMatchRow from this module continue to work.
export type { TeamMatchRow };

export class DrizzleMatchRepository implements MatchRepository {
  constructor(private readonly db: DrizzleDb) {}

  async getById(id: string): Promise<MatchRecord | null> {
    const rows = await this.db
      .select()
      .from(matchTable)
      .where(eq(matchTable.id, id))
      .limit(1);

    if (rows.length === 0) return null;

    return this.rowToRecord(rows[0]);
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
    const values: Partial<typeof matchTable.$inferInsert> = {};

    if (update.homeScore !== undefined) values.homeScore = update.homeScore;
    if (update.awayScore !== undefined) values.awayScore = update.awayScore;
    if (update.resultSource !== undefined) values.resultSource = update.resultSource;
    if (update.settledAt !== undefined) values.settledAt = update.settledAt;
    if (update.status !== undefined) values.status = update.status;

    if (Object.keys(values).length === 0) return;

    await this.db.update(matchTable).set(values).where(eq(matchTable.id, id));
  }

  async getTeamMatches(teamCode: string): Promise<TeamMatchRow[]> {
    const home = alias(teamTable, "home");
    const away = alias(teamTable, "away");

    return this.db
      .select({
        id: matchTable.id,
        homeName: home.name,
        homeCode: home.code,
        awayName: away.name,
        awayCode: away.code,
        kickoffUtc: matchTable.kickoffUtc,
        status: matchTable.status,
        homeScore: matchTable.homeScore,
        awayScore: matchTable.awayScore,
        groupLabel: matchTable.groupLabel,
      })
      .from(matchTable)
      .leftJoin(home, eq(matchTable.homeTeamId, home.id))
      .leftJoin(away, eq(matchTable.awayTeamId, away.id))
      .where(or(eq(home.code, teamCode), eq(away.code, teamCode)))
      .orderBy(asc(matchTable.kickoffUtc))
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          homeName: r.homeName ?? "",
          homeCode: r.homeCode,
          awayName: r.awayName ?? "",
          awayCode: r.awayCode,
          kickoffUtc: r.kickoffUtc,
          status: r.status,
          homeScore: r.homeScore ?? null,
          awayScore: r.awayScore ?? null,
          groupLabel: r.groupLabel ?? null,
        }))
      );
  }

  private rowToRecord(row: typeof matchTable.$inferSelect): MatchRecord {
    return {
      id: row.id,
      tournamentId: row.tournamentId,
      homeTeamId: row.homeTeamId,
      awayTeamId: row.awayTeamId,
      kickoffUtc: row.kickoffUtc,
      status: row.status,
      homeScore: row.homeScore ?? null,
      awayScore: row.awayScore ?? null,
      resultSource: row.resultSource ?? null,
      settledAt: row.settledAt ?? null,
    };
  }
}

// Keep the old name exported as an alias so existing call sites
// that import LibSqlMatchRepository continue to compile during migration.
export { DrizzleMatchRepository as LibSqlMatchRepository };

/**
 * DrizzleMatchRepository — implements MatchRepository port against Turso/libSQL
 * using Drizzle ORM query builder.
 *
 * Replaces the raw SQL LibSqlMatchRepository.
 * Column names mirror the schema in db/migrations/0001_init.sql.
 */

import { eq } from "drizzle-orm";
import type { DrizzleDb } from "#/infra/db/client";
import { match as matchTable } from "#/infra/db/schema";
import type {
  MatchRepository,
  MatchRecord,
} from "#/domain/ports/repositories";

export class DrizzleMatchRepository implements MatchRepository {
  constructor(private readonly db: DrizzleDb) {}

  async getById(id: string): Promise<MatchRecord | null> {
    const rows = await this.db
      .select()
      .from(matchTable)
      .where(eq(matchTable.id, id))
      .limit(1);

    if (rows.length === 0) return null;

    return this.rowToRecord(rows[0]!);
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

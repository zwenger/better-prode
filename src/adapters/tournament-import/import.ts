/**
 * importTournament — idempotent tournament structure import.
 *
 * Upserts tournament, teams, and matches from a TournamentStructure into
 * the Drizzle-managed database using onConflictDoUpdate on PKs.
 *
 * CRITICAL INVARIANT (spec: Req — Idempotent Structure Import):
 *   The conflict update for matches MUST NOT touch result fields:
 *   homeScore, awayScore, status, settledAt, resultSource.
 *   Those fields are owned exclusively by the live-results / settlement path
 *   (applyMatchResult). This import only seeds/refreshes structural fields:
 *   kickoffUtc, group_label, stage_id, home_team_id, away_team_id.
 *
 * Design decision #3 (from design.md):
 *   Drizzle insert().onConflictDoUpdate() on PK — no INSERT OR IGNORE /
 *   delete+recreate. Re-run updates changed fields without duplicating rows
 *   or losing FK-referenced predictions.
 *
 * Returns ImportResult with counts and any warnings (e.g. unmapped ISO codes).
 */

import { sql } from "drizzle-orm";
import type { DrizzleDb } from "#/infra/db/client";
import type { TournamentStructure } from "#/domain/ports/tournament-source";
import {
  tournament as tournamentTable,
  team as teamTable,
  match as matchTable,
} from "#/infra/db/schema";

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface ImportResult {
  /** Number of tournament, team, and match rows upserted in this run. */
  upsertedTeams: number;
  upsertedMatches: number;
  /** Non-fatal warnings (e.g. unmapped ISO codes). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Idempotently import a TournamentStructure into the database.
 *
 * Safe to re-run: each call is a full upsert. Result fields on matches
 * (homeScore, awayScore, status, settledAt) are NEVER overwritten.
 */
export async function importTournament(
  structure: TournamentStructure,
  db: DrizzleDb
): Promise<ImportResult> {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  // -------------------------------------------------------------------------
  // 1. Upsert tournament row
  // -------------------------------------------------------------------------
  await db
    .insert(tournamentTable)
    .values({
      id: structure.tournamentId,
      name: structure.name,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: tournamentTable.id,
      set: { name: structure.name },
    });

  // -------------------------------------------------------------------------
  // 2. Upsert teams
  // -------------------------------------------------------------------------
  for (const team of structure.teams) {
    if (team.code === null) {
      warnings.push(
        `Team ${team.id} (${team.name}) has no ISO code mapping — team.code will be null`
      );
    }

    await db
      .insert(teamTable)
      .values({
        id: team.id,
        tournamentId: structure.tournamentId,
        name: team.name,
        code: team.code,
      })
      .onConflictDoUpdate({
        target: teamTable.id,
        set: {
          name: team.name,
          code: team.code,
        },
      });
  }

  // -------------------------------------------------------------------------
  // 3. Upsert matches — NEVER overwrite result fields
  //
  // The conflict update only refreshes structural fields:
  //   kickoffUtc, groupLabel, stageId, homeTeamId, awayTeamId
  //
  // Excluded from conflict update (owned by settlement path):
  //   status, homeScore, awayScore, settledAt, resultSource
  // -------------------------------------------------------------------------
  for (const m of structure.matches) {
    await db
      .insert(matchTable)
      .values({
        id: m.id,
        tournamentId: structure.tournamentId,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        kickoffUtc: m.kickoffUtc,
        status: m.status,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        groupLabel: m.group,
        stageId: m.stage,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: matchTable.id,
        set: {
          // Structural fields — safe to refresh
          kickoffUtc: sql`excluded.kickoff_utc`,
          homeTeamId: sql`excluded.home_team_id`,
          awayTeamId: sql`excluded.away_team_id`,
          groupLabel: sql`excluded.group_label`,
          stageId: sql`excluded.stage_id`,
          // Result fields intentionally OMITTED:
          //   status, homeScore, awayScore, settledAt, resultSource
        },
      });
  }

  return {
    upsertedTeams: structure.teams.length,
    upsertedMatches: structure.matches.length,
    warnings,
  };
}

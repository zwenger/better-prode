/**
 * TDD 2.1 (RED): importTournament — idempotency tests against local libSQL :memory:
 * TDD 2.3 (RED): tournament row idempotency
 *
 * Integration tests against a local in-memory libSQL instance (migration-backed).
 * NEVER calls live api.fifa.com — all data comes from TournamentStructure fixtures.
 *
 * Spec coverage:
 *  - First import seeds all structure (tournament, teams, matches)
 *  - Re-run with same data → no duplicates (idempotent by PK)
 *  - Re-run with updated kickoffUtc → value is updated
 *  - Re-run does NOT overwrite homeScore/awayScore/status/settledAt
 *  - Unmapped team (null code) emits warning in return value
 *  - tournament table has exactly 1 row after two runs (task 2.3)
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "#/adapters/db/test-helpers";
import type { DrizzleDb } from "#/infra/db/client";
import { importTournament } from "./import";
import type { TournamentStructure } from "#/domain/ports/tournament-source";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_STRUCTURE: TournamentStructure = {
  tournamentId: "17-285023",
  name: "FIFA World Cup 2026™",
  teams: [
    { id: "fifa-t-43911", name: "Mexico", code: "MX" },
    { id: "fifa-t-43854", name: "Côte d'Ivoire", code: "CI" },
    { id: "fifa-t-12345", name: "Unknown Nation", code: null },
  ],
  matches: [
    {
      id: "fifa-m-400021443",
      homeTeamId: "fifa-t-43911",
      awayTeamId: "fifa-t-43854",
      kickoffUtc: "2026-06-15T18:00:00.000Z",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      group: "Group A",
      stage: "289273",
    },
    {
      id: "fifa-m-400021444",
      homeTeamId: "fifa-t-43854",
      awayTeamId: "fifa-t-12345",
      kickoffUtc: "2026-06-16T21:00:00.000Z",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      group: "Group A",
      stage: "289273",
    },
  ],
};

/** Structure with an updated kickoff on the first match (reschedule scenario). */
const RESCHEDULED_STRUCTURE: TournamentStructure = {
  ...BASE_STRUCTURE,
  matches: [
    {
      ...BASE_STRUCTURE.matches[0]!,
      kickoffUtc: "2026-06-15T21:00:00.000Z", // 3 hours later
    },
    ...BASE_STRUCTURE.matches.slice(1),
  ],
};

/** Structure with a finished match — simulates settled match. */
function finishedStructure(matchId: string): TournamentStructure {
  return {
    ...BASE_STRUCTURE,
    matches: [
      {
        ...BASE_STRUCTURE.matches[0]!,
        id: matchId,
        status: "finished",
        homeScore: 2,
        awayScore: 1,
      },
      ...BASE_STRUCTURE.matches.slice(1),
    ],
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let db: DrizzleDb & { $client: Client };

beforeEach(async () => {
  db = await createTestDb();
});

// ---------------------------------------------------------------------------
// Task 2.1: Idempotency (no duplicates, updated fields, result fields preserved)
// ---------------------------------------------------------------------------

describe("importTournament — idempotency", () => {
  it("returns upserted counts on first import", async () => {
    const result = await importTournament(BASE_STRUCTURE, db);
    expect(result.upsertedTeams).toBe(3);
    expect(result.upsertedMatches).toBe(2);
  });

  it("re-run with same data does NOT duplicate rows", async () => {
    await importTournament(BASE_STRUCTURE, db);
    await importTournament(BASE_STRUCTURE, db);

    const tournaments = await db.query.tournament.findMany();
    const teams = await db.query.team.findMany();
    const matches = await db.query.match.findMany();

    expect(tournaments).toHaveLength(1);
    expect(teams).toHaveLength(3);
    expect(matches).toHaveLength(2);
  });

  it("re-run with updated kickoffUtc updates the value", async () => {
    await importTournament(BASE_STRUCTURE, db);
    await importTournament(RESCHEDULED_STRUCTURE, db);

    const updated = await db.query.match.findFirst({
      where: (m, { eq }) => eq(m.id, "fifa-m-400021443"),
    });
    expect(updated?.kickoffUtc).toBe("2026-06-15T21:00:00.000Z");
  });

  it("re-run does NOT overwrite homeScore/awayScore/status/settledAt of a settled match", async () => {
    const settledMatchId = "fifa-m-400021443";

    // First import seeds the match as scheduled (no score)
    await importTournament(BASE_STRUCTURE, db);

    // Simulate the live-results path settling this match directly in DB
    const now = new Date().toISOString();
    await db.$client.execute({
      sql: `UPDATE match SET status = 'finished', home_score = 3, away_score = 0, settled_at = ? WHERE id = ?`,
      args: [now, settledMatchId],
    });

    // Second import (from FIFA API which may report same finished match data)
    await importTournament(finishedStructure(settledMatchId), db);

    const row = await db.query.match.findFirst({
      where: (m, { eq }) => eq(m.id, settledMatchId),
    });

    // Settlement data must NOT be overwritten by import
    expect(row?.homeScore).toBe(3); // settlement wrote 3, import must not change it
    expect(row?.awayScore).toBe(0);
    expect(row?.status).toBe("finished");
    expect(row?.settledAt).toBe(now);
  });

  it("emits a warning in return value for unmapped team (null code)", async () => {
    const result = await importTournament(BASE_STRUCTURE, db);
    expect(result.warnings.some((w) => w.includes("fifa-t-12345"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 2.3: Tournament row idempotency
// ---------------------------------------------------------------------------

describe("importTournament — tournament row idempotency (task 2.3)", () => {
  it("tournament table has exactly 1 row after two runs", async () => {
    const result1 = await importTournament(BASE_STRUCTURE, db);
    const result2 = await importTournament(BASE_STRUCTURE, db);

    const rows = await db.query.tournament.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("17-285023");

    // Both runs should report same team count
    expect(result1.upsertedTeams).toBe(result2.upsertedTeams);
  });

  it("second run returns same upsertedTeams count as first run", async () => {
    const result1 = await importTournament(BASE_STRUCTURE, db);
    const result2 = await importTournament(BASE_STRUCTURE, db);
    expect(result2.upsertedTeams).toBe(result1.upsertedTeams);
  });
});

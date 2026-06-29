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
      homePlaceholder: null,
      awayPlaceholder: null,
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
      homePlaceholder: null,
      awayPlaceholder: null,
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
// Array access is non-nullable in this tsconfig (no noUncheckedIndexedAccess)
const FIRST_MATCH = BASE_STRUCTURE.matches[0];

const RESCHEDULED_STRUCTURE: TournamentStructure = {
  ...BASE_STRUCTURE,
  matches: [
    {
      ...FIRST_MATCH,
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
        ...FIRST_MATCH,
        id: matchId,
        status: "finished",
        homeScore: 2,
        awayScore: 1,
        homePlaceholder: null,
        awayPlaceholder: null,
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
// TBD match import (spec: Import Persistence and Repoint)
// ---------------------------------------------------------------------------

describe("importTournament — TBD match upsert and repoint", () => {
  it("initial import of a TBD match stores null team IDs and placeholder codes", async () => {
    // Seed tournament (no teams needed — TBD match has no FK targets)
    await db.$client.execute({
      sql: `INSERT INTO tournament (id, name, created_at) VALUES ('17-285023', 'FIFA WC 2026', '2026-01-01')`,
      args: [],
    });

    const tbdStructure: TournamentStructure = {
      tournamentId: "17-285023",
      name: "FIFA World Cup 2026™",
      teams: [],
      matches: [
        {
          id: "fifa-m-tbd-001",
          homeTeamId: null,
          awayTeamId: null,
          homePlaceholder: "W74",
          awayPlaceholder: "RU101",
          kickoffUtc: "2026-07-01T20:00:00.000Z",
          status: "scheduled",
          homeScore: null,
          awayScore: null,
          group: "",
          stage: "289274",
        },
      ],
    };

    await importTournament(tbdStructure, db);

    const row = await db.query.match.findFirst({
      where: (m, { eq }) => eq(m.id, "fifa-m-tbd-001"),
    });

    expect(row).toBeDefined();
    expect(row?.homeTeamId).toBeNull();
    expect(row?.awayTeamId).toBeNull();
    expect(row?.homePlaceholder).toBe("W74");
    expect(row?.awayPlaceholder).toBe("RU101");
  });

  it("repoint: subsequent import with concrete team ID sets it and clears placeholder", async () => {
    await db.$client.execute({
      sql: `INSERT INTO tournament (id, name, created_at) VALUES ('17-285023', 'FIFA WC 2026', '2026-01-01')`,
      args: [],
    });
    await db.$client.execute({
      sql: `INSERT INTO team (id, tournament_id, name, code) VALUES ('fifa-t-43911', '17-285023', 'Mexico', 'MX')`,
      args: [],
    });

    // Initial TBD import
    const tbdStructure: TournamentStructure = {
      tournamentId: "17-285023",
      name: "FIFA World Cup 2026™",
      teams: [],
      matches: [
        {
          id: "fifa-m-tbd-002",
          homeTeamId: null,
          awayTeamId: null,
          homePlaceholder: "W74",
          awayPlaceholder: "RU101",
          kickoffUtc: "2026-07-01T20:00:00.000Z",
          status: "scheduled",
          homeScore: null,
          awayScore: null,
          group: "",
          stage: "289274",
        },
      ],
    };
    await importTournament(tbdStructure, db);

    // Simulate settlement path setting status/score on the match (must NOT be overwritten)
    await db.$client.execute({
      sql: `UPDATE match SET status = 'finished', home_score = 2, away_score = 1 WHERE id = 'fifa-m-tbd-002'`,
      args: [],
    });

    // Repoint: FIFA API now provides concrete home team, away side still TBD
    const repointStructure: TournamentStructure = {
      tournamentId: "17-285023",
      name: "FIFA World Cup 2026™",
      teams: [{ id: "fifa-t-43911", name: "Mexico", code: "MX" }],
      matches: [
        {
          id: "fifa-m-tbd-002",
          homeTeamId: "fifa-t-43911",
          awayTeamId: null,
          homePlaceholder: null,
          awayPlaceholder: "RU101",
          kickoffUtc: "2026-07-01T20:00:00.000Z",
          status: "scheduled",
          homeScore: null,
          awayScore: null,
          group: "",
          stage: "289274",
        },
      ],
    };
    await importTournament(repointStructure, db);

    const row = await db.query.match.findFirst({
      where: (m, { eq }) => eq(m.id, "fifa-m-tbd-002"),
    });

    expect(row?.homeTeamId).toBe("fifa-t-43911");
    expect(row?.homePlaceholder).toBeNull();
    expect(row?.awayTeamId).toBeNull();
    expect(row?.awayPlaceholder).toBe("RU101");
    // Result fields must NOT be overwritten by import
    expect(row?.status).toBe("finished");
    expect(row?.homeScore).toBe(2);
    expect(row?.awayScore).toBe(1);
  });

  it("repoint is idempotent — re-running resolved import produces no error", async () => {
    await db.$client.execute({
      sql: `INSERT INTO tournament (id, name, created_at) VALUES ('17-285023', 'FIFA WC 2026', '2026-01-01')`,
      args: [],
    });
    await db.$client.execute({
      sql: `INSERT INTO team (id, tournament_id, name, code) VALUES ('fifa-t-43911', '17-285023', 'Mexico', 'MX'), ('fifa-t-43854', '17-285023', 'Ivory Coast', 'CI')`,
      args: [],
    });

    const resolvedStructure: TournamentStructure = {
      tournamentId: "17-285023",
      name: "FIFA World Cup 2026™",
      teams: [
        { id: "fifa-t-43911", name: "Mexico", code: "MX" },
        { id: "fifa-t-43854", name: "Ivory Coast", code: "CI" },
      ],
      matches: [
        {
          id: "fifa-m-resolved-001",
          homeTeamId: "fifa-t-43911",
          awayTeamId: "fifa-t-43854",
          homePlaceholder: null,
          awayPlaceholder: null,
          kickoffUtc: "2026-07-01T20:00:00.000Z",
          status: "scheduled",
          homeScore: null,
          awayScore: null,
          group: "",
          stage: "289274",
        },
      ],
    };

    await expect(importTournament(resolvedStructure, db)).resolves.not.toThrow();
    await expect(importTournament(resolvedStructure, db)).resolves.not.toThrow();

    const matches = await db.query.match.findMany();
    expect(matches.filter((m) => m.id === "fifa-m-resolved-001")).toHaveLength(1);
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
    expect(rows[0]?.id).toBe("17-285023");

    // Both runs should report same team count
    expect(result1.upsertedTeams).toBe(result2.upsertedTeams);
  });

  it("second run returns same upsertedTeams count as first run", async () => {
    const result1 = await importTournament(BASE_STRUCTURE, db);
    const result2 = await importTournament(BASE_STRUCTURE, db);
    expect(result2.upsertedTeams).toBe(result1.upsertedTeams);
  });
});

/**
 * RED tests for runStructureRefresh — dependency-injected unit tests.
 *
 * runStructureRefresh(tournamentId) orchestrates the 6-hour structure-refresh
 * cron path:
 *   1. Split tournamentId ("competitionId-seasonId") on the FIRST dash.
 *   2. fetchStructure(competition, season) from the tournament source.
 *   3. importTournament(structure, db) — idempotent structural upsert.
 *   4. Return the ImportResult.
 *
 * Deps are injected so tests never hit the real FIFA API or DB.
 */

import { describe, it, expect, vi } from "vitest";
import type { ImportResult } from "#/adapters/tournament-import/import";
import type { TournamentStructure } from "#/domain/ports/tournament-source";
import { makeRunStructureRefresh } from "./run-structure-refresh";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOURNAMENT_ID = "17-285023";

function makeStructure(): TournamentStructure {
  return {
    tournamentId: TOURNAMENT_ID,
    name: "FIFA World Cup",
    teams: [],
    matches: [],
  };
}

const IMPORT_RESULT: ImportResult = {
  upsertedTeams: 32,
  upsertedMatches: 64,
  warnings: [],
};

describe("runStructureRefresh (injected deps)", () => {
  it("splits tournamentId into competition + season and passes them to fetchStructure", async () => {
    const structure = makeStructure();
    const fetchStructure = vi.fn().mockResolvedValue(structure);
    const importTournament = vi.fn().mockResolvedValue(IMPORT_RESULT);

    const runStructureRefresh = makeRunStructureRefresh({
      fetchStructure,
      importTournament,
    });

    const result = await runStructureRefresh(TOURNAMENT_ID);

    expect(fetchStructure).toHaveBeenCalledOnce();
    expect(fetchStructure).toHaveBeenCalledWith("17", "285023");
    expect(importTournament).toHaveBeenCalledOnce();
    expect(importTournament).toHaveBeenCalledWith(structure);
    expect(result).toEqual(IMPORT_RESULT);
  });

  it("splits on the FIRST dash only — season retains any later dashes", async () => {
    const fetchStructure = vi.fn().mockResolvedValue(makeStructure());
    const importTournament = vi.fn().mockResolvedValue(IMPORT_RESULT);

    const runStructureRefresh = makeRunStructureRefresh({
      fetchStructure,
      importTournament,
    });

    await runStructureRefresh("17-2850-23");

    // Only the first dash splits: competition="17", season="2850-23".
    expect(fetchStructure).toHaveBeenCalledWith("17", "2850-23");
  });

  it("throws a clear error when tournamentId has no dash", async () => {
    const fetchStructure = vi.fn();
    const importTournament = vi.fn();

    const runStructureRefresh = makeRunStructureRefresh({
      fetchStructure,
      importTournament,
    });

    await expect(runStructureRefresh("17")).rejects.toThrow(
      /malformed tournamentId/i
    );
    expect(fetchStructure).not.toHaveBeenCalled();
    expect(importTournament).not.toHaveBeenCalled();
  });
});

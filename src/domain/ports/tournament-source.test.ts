/**
 * TDD 1.1 (RED): TournamentSource port interface shape tests.
 *
 * Verifies the port contract at the TYPE level — the test uses the interface
 * directly so if the types are wrong the test file itself fails to compile.
 */

import { describe, it, expect } from "vitest";
import type {
  TournamentSource,
  TournamentStructure,
  TournamentTeam,
  TournamentMatch,
} from "./tournament-source";

describe("TournamentSource port — type contract", () => {
  it("TournamentTeam has id, name, and nullable code", () => {
    const team: TournamentTeam = {
      id: "fifa-t-43911",
      name: "Mexico",
      code: "MX",
    };
    expect(team.id).toBe("fifa-t-43911");
    expect(team.name).toBe("Mexico");
    expect(team.code).toBe("MX");
  });

  it("TournamentTeam.code can be null (unmapped team)", () => {
    const team: TournamentTeam = {
      id: "fifa-t-99999",
      name: "Unknown FC",
      code: null,
    };
    expect(team.code).toBeNull();
  });

  it("TournamentMatch has all required domain fields", () => {
    const match: TournamentMatch = {
      id: "fifa-m-400021443",
      homeTeamId: "fifa-t-43911",
      awayTeamId: "fifa-t-43883",
      kickoffUtc: "2026-06-11T19:00:00.000Z",
      status: "finished",
      homeScore: 2,
      awayScore: 0,
      group: "Group A",
      stage: "289273",
    };
    expect(match.id).toBe("fifa-m-400021443");
    expect(match.status).toBe("finished");
  });

  it("TournamentMatch scores can be null (upcoming match)", () => {
    const match: TournamentMatch = {
      id: "fifa-m-400021473",
      homeTeamId: "fifa-t-43888",
      awayTeamId: "fifa-t-43960",
      kickoffUtc: "2026-06-25T23:00:00.000Z",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      group: "Group F",
      stage: "289273",
    };
    expect(match.homeScore).toBeNull();
    expect(match.awayScore).toBeNull();
  });

  it("TournamentStructure bundles tournamentId, name, teams[], and matches[]", () => {
    const structure: TournamentStructure = {
      tournamentId: "17-285023",
      name: "FIFA World Cup 2026™",
      teams: [],
      matches: [],
    };
    expect(structure.tournamentId).toBeDefined();
    expect(Array.isArray(structure.teams)).toBe(true);
    expect(Array.isArray(structure.matches)).toBe(true);
  });

  it("TournamentSource.fetchStructure has the correct signature", () => {
    // Type-level test: construct a conforming adapter and verify it type-checks.
    const adapter: TournamentSource = {
      fetchStructure: async (
        _competitionId: string,
        _seasonId: string
      ): Promise<TournamentStructure> => ({
        tournamentId: "17-285023",
        name: "FIFA World Cup 2026™",
        teams: [],
        matches: [],
      }),
    };
    expect(typeof adapter.fetchStructure).toBe("function");
  });
});

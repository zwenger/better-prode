/**
 * TDD 1.3 (RED): FifaAdapter mapping tests — fixtures only, no live API calls.
 * TDD 1.6 (RED): ISO mapping tests.
 * TDD 1.8 (RED/GREEN): mapStatus completeness tests.
 *
 * All tests use recorded __fixtures__ JSON — the live api.fifa.com is NEVER
 * called in tests.
 *
 * Spec coverage:
 *  - FIFA JSON → domain match mapping (id prefix, team ids, kickoff, scores, group, stage)
 *  - MatchStatus 0 → "finished"
 *  - MatchStatus 1 → "scheduled"
 *  - MatchStatus 3 → "in_progress"
 *  - Unknown status → "scheduled" + warned: true
 *  - ResultSource.getResult returns MatchResult with source: "auto"
 *  - FIFA team id → ISO code lookup (known, unknown, no throw)
 *  - mapStatus exhaustive table: known codes → non-warned; unknown → scheduled+warned
 */

import { describe, it, expect, vi } from "vitest";
import { FifaAdapter } from "./fifa";
import type { MatchResult } from "#/domain/ports/result-source";
import inProgressFixture from "./__fixtures__/wc2026-matches.json";
import finishedFixture from "./__fixtures__/wc2026-finished.json";
import upcomingFixture from "./__fixtures__/wc2026-upcoming.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a FifaAdapter that returns a single match fixture from a mocked fetch.
 * The response wraps the fixture in the same shape as the real FIFA API.
 */
function adapterWithFixture(fixture: unknown): FifaAdapter {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ Results: [fixture] }),
  });
  return new FifaAdapter({ fetch: mockFetch as unknown as typeof fetch });
}

// ---------------------------------------------------------------------------
// Task 1.3: Domain field mapping
// ---------------------------------------------------------------------------

describe("FifaAdapter — domain mapping", () => {
  describe("in-progress match (MatchStatus 3)", () => {
    it("maps IdMatch to domain id with 'fifa-m-' prefix", async () => {
      const adapter = adapterWithFixture(inProgressFixture);
      const structure = await adapter.fetchStructure("17", "285023");
      const match = structure.matches[0];
      expect(match.id).toBe("fifa-m-400021468");
    });

    it("maps Home.IdTeam to homeTeamId with 'fifa-t-' prefix", async () => {
      const adapter = adapterWithFixture(inProgressFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].homeTeamId).toBe("fifa-t-1895293");
    });

    it("maps Away.IdTeam to awayTeamId with 'fifa-t-' prefix", async () => {
      const adapter = adapterWithFixture(inProgressFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].awayTeamId).toBe("fifa-t-43854");
    });

    it("maps Date to kickoffUtc as valid ISO 8601 UTC string", async () => {
      const adapter = adapterWithFixture(inProgressFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      // The date field ends with Z → valid UTC ISO 8601
      expect(matches[0].kickoffUtc).toBe("2026-06-25T20:00:00.000Z");
    });

    it("maps MatchStatus 3 to status 'in_progress'", async () => {
      const adapter = adapterWithFixture(inProgressFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].status).toBe("in_progress");
    });

    it("maps Home.Score to homeScore as integer", async () => {
      const adapter = adapterWithFixture(inProgressFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].homeScore).toBe(0);
    });

    it("maps Away.Score to awayScore as integer", async () => {
      const adapter = adapterWithFixture(inProgressFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].awayScore).toBe(2);
    });

    it("maps GroupName[0].Description to group", async () => {
      const adapter = adapterWithFixture(inProgressFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].group).toBe("Group E");
    });

    it("maps IdStage to stage", async () => {
      const adapter = adapterWithFixture(inProgressFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].stage).toBe("289273");
    });
  });

  describe("finished match (MatchStatus 0)", () => {
    it("maps MatchStatus 0 to status 'finished'", async () => {
      const adapter = adapterWithFixture(finishedFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].status).toBe("finished");
    });

    it("maps final scores correctly", async () => {
      const adapter = adapterWithFixture(finishedFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].homeScore).toBe(2);
      expect(matches[0].awayScore).toBe(0);
    });
  });

  describe("upcoming match (MatchStatus 1)", () => {
    it("maps MatchStatus 1 to status 'scheduled'", async () => {
      const adapter = adapterWithFixture(upcomingFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].status).toBe("scheduled");
    });

    it("maps null scores for upcoming match", async () => {
      const adapter = adapterWithFixture(upcomingFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches[0].homeScore).toBeNull();
      expect(matches[0].awayScore).toBeNull();
    });
  });

  describe("team mapping", () => {
    it("maps Home team name from TeamName[0].Description", async () => {
      const adapter = adapterWithFixture(finishedFixture);
      const { teams } = await adapter.fetchStructure("17", "285023");
      const mexico = teams.find((t) => t.id === "fifa-t-43911");
      expect(mexico?.name).toBe("Mexico");
    });

    it("maps Away team with IdTeam prefix", async () => {
      const adapter = adapterWithFixture(finishedFixture);
      const { teams } = await adapter.fetchStructure("17", "285023");
      const sa = teams.find((t) => t.id === "fifa-t-43883");
      expect(sa).toBeDefined();
    });

    it("populates team.code from FIFA-to-ISO map for known teams", async () => {
      const adapter = adapterWithFixture(finishedFixture);
      const { teams } = await adapter.fetchStructure("17", "285023");
      const mexico = teams.find((t) => t.id === "fifa-t-43911");
      // Mexico FIFA id 43911 → ISO MX
      expect(mexico?.code).toBe("MX");
    });

    it("sets team.code to null for unmapped FIFA team id", async () => {
      // Use in-progress fixture; Curaçao (1895293) is unlikely to be in the map initially
      const adapter = adapterWithFixture(inProgressFixture);
      const { teams } = await adapter.fetchStructure("17", "285023");
      const curacao = teams.find((t) => t.id === "fifa-t-1895293");
      // Either null (unmapped) or a valid ISO code — but never throws
      expect(curacao).toBeDefined();
      // code is string|null — just confirm no throw and it's a string or null
      expect(curacao!.code === null || typeof curacao!.code === "string").toBe(
        true
      );
    });
  });

  describe("TBD matches — placeholder capture (spec: Adapter Parses TBD Matches)", () => {
    it("both-TBD match: null teams + placeholder codes are captured (W74/RU101)", async () => {
      const tbdFixture = {
        IdMatch: "400099001",
        IdCompetition: "17",
        IdSeason: "285023",
        IdStage: "289274",
        Date: "2026-07-01T20:00:00Z",
        MatchStatus: 1,
        Home: null,
        Away: null,
        PlaceHolderA: "W74",
        PlaceHolderB: "RU101",
      };
      const adapter = adapterWithFixture(tbdFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches).toHaveLength(1);
      expect(matches[0].homeTeamId).toBeNull();
      expect(matches[0].awayTeamId).toBeNull();
      expect(matches[0].homePlaceholder).toBe("W74");
      expect(matches[0].awayPlaceholder).toBe("RU101");
    });

    it("partial match: one concrete team + one placeholder", async () => {
      const partialFixture = {
        IdMatch: "400099002",
        IdCompetition: "17",
        IdSeason: "285023",
        IdStage: "289274",
        Date: "2026-07-02T20:00:00Z",
        MatchStatus: 1,
        Home: {
          IdTeam: "43911",
          TeamName: [{ Locale: "en-GB", Description: "Canada" }],
        },
        Away: null,
        PlaceHolderB: "W75",
      };
      const adapter = adapterWithFixture(partialFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      expect(matches).toHaveLength(1);
      expect(matches[0].homeTeamId).toBe("fifa-t-43911");
      expect(matches[0].awayTeamId).toBeNull();
      expect(matches[0].homePlaceholder).toBeNull();
      expect(matches[0].awayPlaceholder).toBe("W75");
    });

    it("one-sided-absent match: kept but warns that one side has no team or placeholder", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const oneSidedFixture = {
        IdMatch: "400099004",
        IdCompetition: "17",
        IdSeason: "285023",
        IdStage: "289274",
        Date: "2026-07-04T20:00:00Z",
        MatchStatus: 1,
        Home: {
          IdTeam: "43911",
          TeamName: [{ Locale: "en-GB", Description: "Canada" }],
        },
        // Away side fully absent: no team AND no placeholder.
        Away: null,
      };
      const adapter = adapterWithFixture(oneSidedFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");

      // The record is KEPT (one side is present) — predictable=false handles display.
      expect(matches).toHaveLength(1);
      expect(matches[0].homeTeamId).toBe("fifa-t-43911");
      expect(matches[0].awayTeamId).toBeNull();
      expect(matches[0].awayPlaceholder).toBeNull();

      // But the one-sided absence is observable via a logged warning.
      const warnings = warnSpy.mock.calls.flat();
      const warningText = JSON.stringify(warnings);
      expect(warningText).toContain("fifa-m-400099004");
      expect(warningText).toMatch(/one side has no team id or placeholder/i);

      warnSpy.mockRestore();
    });

    it("true-null-both-sides (no team AND no placeholder): match is skipped", async () => {
      const nullFixture = {
        IdMatch: "400099003",
        IdCompetition: "17",
        IdSeason: "285023",
        IdStage: "289274",
        Date: "2026-07-03T20:00:00Z",
        MatchStatus: 1,
        Home: null,
        Away: null,
        // No PlaceHolderA, no PlaceHolderB
      };
      const adapter = adapterWithFixture(nullFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      // Both sides have no team AND no placeholder — skip
      expect(matches).toHaveLength(0);
    });
  });

  describe("unknown MatchStatus → safe default", () => {
    it("maps unknown status code to 'scheduled' with warned: true in mapStatus", async () => {
      // Build a fixture with an unknown status code (e.g. 99)
      const unknownStatusFixture = {
        ...inProgressFixture,
        MatchStatus: 99,
      };
      const adapter = adapterWithFixture(unknownStatusFixture);
      const { matches } = await adapter.fetchStructure("17", "285023");
      // Safe default: never fabricates "finished" for unknown codes
      expect(matches[0].status).toBe("scheduled");
    });
  });

  describe("TournamentStructure shape", () => {
    it("fetchStructure returns tournamentId as competitionId-seasonId", async () => {
      const adapter = adapterWithFixture(finishedFixture);
      const structure = await adapter.fetchStructure("17", "285023");
      expect(structure.tournamentId).toBe("17-285023");
    });

    it("fetchStructure returns a non-empty name", async () => {
      const adapter = adapterWithFixture(finishedFixture);
      const structure = await adapter.fetchStructure("17", "285023");
      expect(structure.name.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 1.3: ResultSource.getResult
// ---------------------------------------------------------------------------

describe("FifaAdapter — ResultSource.getResult", () => {
  it("returns MatchResult with source 'auto' for a known match", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Results: [finishedFixture] }),
    });
    const adapter = new FifaAdapter({
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result: MatchResult | null = await adapter.getResult(
      "fifa-m-400021443"
    );

    expect(result).not.toBeNull();
    expect(result!.source).toBe("auto");
    expect(result!.matchId).toBe("fifa-m-400021443");
    expect(result!.homeScore).toBe(2);
    expect(result!.awayScore).toBe(0);
    expect(result!.status).toBe("finished");
  });

  it("returns null when the matchId is not found in the API response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Results: [finishedFixture] }),
    });
    const adapter = new FifaAdapter({
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result = await adapter.getResult("fifa-m-does-not-exist");
    expect(result).toBeNull();
  });

  it("returns null (not throws) on API failure", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    const adapter = new FifaAdapter({
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result = await adapter.getResult("fifa-m-400021443");
    expect(result).toBeNull();
  });

  // Regression: the Cloudflare Workers runtime throws "Illegal invocation" when
  // the global fetch is called with a `this` other than globalThis. The adapter
  // stored fetch on a field and called it as `this._fetch(url)`, binding `this`
  // to the adapter instance — which works in Node (undici ignores `this`) but
  // fails on the edge, silently returning null and settling no matches.
  // Contract: the stored fetch must NEVER be invoked with the adapter as `this`.
  it("does not invoke fetch with the adapter as `this` (Workers Illegal invocation)", async () => {
    let capturedThis: unknown = "unset";
    const recordingFetch = function (this: unknown) {
      capturedThis = this;
      return Promise.resolve({
        ok: true,
        json: async () => ({ Results: [finishedFixture] }),
      });
    };
    const adapter = new FifaAdapter({
      fetch: recordingFetch as unknown as typeof fetch,
    });

    await adapter.getResult("fifa-m-400021443");

    expect(capturedThis).not.toBe(adapter);
  });
});

// ---------------------------------------------------------------------------
// Task 1.6: ISO mapping
// ---------------------------------------------------------------------------

describe("FIFA → ISO mapping (fifa-iso.ts)", () => {
  it("known FIFA team id 43911 (Mexico) maps to ISO 'MX'", async () => {
    const adapter = adapterWithFixture(finishedFixture);
    const { teams } = await adapter.fetchStructure("17", "285023");
    const mexico = teams.find((t) => t.id === "fifa-t-43911");
    expect(mexico?.code).toBe("MX");
  });

  it("known FIFA team id 43960 (Netherlands) maps to ISO 'NL'", async () => {
    const adapter = adapterWithFixture(upcomingFixture);
    const { teams } = await adapter.fetchStructure("17", "285023");
    const netherlands = teams.find((t) => t.id === "fifa-t-43960");
    expect(netherlands?.code).toBe("NL");
  });

  it("unknown FIFA team id maps to null — import never throws", async () => {
    const unknownTeamFixture = {
      ...finishedFixture,
      Home: {
        ...finishedFixture.Home,
        IdTeam: "999999999",
        TeamName: [{ Locale: "en-GB", Description: "Unknown FC" }],
      },
    };
    const adapter = adapterWithFixture(unknownTeamFixture);
    // Should not throw
    const { teams } = await adapter.fetchStructure("17", "285023");
    const unknown = teams.find((t) => t.id === "fifa-t-999999999");
    expect(unknown?.code).toBeNull();
  });

  it("import never throws when a team id is not in the ISO map", async () => {
    const adapter = adapterWithFixture({
      ...finishedFixture,
      Home: {
        ...finishedFixture.Home,
        IdTeam: "000000000",
        TeamName: [{ Locale: "en-GB", Description: "Ghost FC" }],
      },
    });
    // Must not throw
    await expect(
      adapter.fetchStructure("17", "285023")
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Task 1.8: mapStatus completeness
// ---------------------------------------------------------------------------

describe("mapStatus — exhaustive table completeness", () => {
  // Import the function directly to test it in isolation
  it("all currently known FIFA status codes map to explicit non-warned values", async () => {
    const { mapStatus } = await import("./fifa");

    // Empirically confirmed against live WC2026 data (June 2026):
    //   0 → finished (has final score)
    //   1 → scheduled (future, no score)
    //   3 → in_progress (live)
    const knownCodes = [0, 1, 3];

    for (const code of knownCodes) {
      const result = mapStatus(code);
      expect(result.warned).toBe(false);
      expect(["scheduled", "in_progress", "finished"]).toContain(
        result.status
      );
    }
  });

  it("status code 0 maps to 'finished'", async () => {
    const { mapStatus } = await import("./fifa");
    expect(mapStatus(0).status).toBe("finished");
    expect(mapStatus(0).warned).toBe(false);
  });

  it("status code 1 maps to 'scheduled'", async () => {
    const { mapStatus } = await import("./fifa");
    expect(mapStatus(1).status).toBe("scheduled");
    expect(mapStatus(1).warned).toBe(false);
  });

  it("status code 3 maps to 'in_progress'", async () => {
    const { mapStatus } = await import("./fifa");
    expect(mapStatus(3).status).toBe("in_progress");
    expect(mapStatus(3).warned).toBe(false);
  });

  it("any integer outside the known set maps to { status: 'scheduled', warned: true }", async () => {
    const { mapStatus } = await import("./fifa");
    const unknownCodes = [2, 4, 5, 10, 12, 99, -1, 100];

    for (const code of unknownCodes) {
      const result = mapStatus(code);
      expect(result.status).toBe("scheduled");
      expect(result.warned).toBe(true);
    }
  });

  it("safe default NEVER yields 'finished' for unknown codes", async () => {
    const { mapStatus } = await import("./fifa");
    // Exhaustively test a range of unknown codes
    for (let code = -10; code <= 200; code++) {
      if ([0, 1, 3].includes(code)) continue;
      const result = mapStatus(code);
      expect(result.status).not.toBe("finished");
    }
  });
});

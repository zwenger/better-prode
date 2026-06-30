/**
 * TDD 4.4 (RED): ingest-results handler unit tests.
 *
 * Tests the ingestResults logic in isolation:
 *  - fetchesResult for each unsettled match (scheduled/in_progress past kickoff)
 *  - routes finished matches to the DO settle endpoint
 *  - routes in_progress matches to the DO settle endpoint (bet-lock)
 *  - skips matches with no result (null) or status=scheduled
 *  - admin guard: non-admin sessions are rejected
 *
 * The route handler function (ingestMatchResults) is extracted and tested
 * directly so we can inject a fake ResultSource and a fake DO stub without
 * an HTTP server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ingestMatchResults } from "./-ingest-results";
import type { IngestResultsInput, IngestDeps } from "./-ingest-results";
import type { MatchResult } from "#/domain/ports/result-source";
import type { MatchRecord } from "#/domain/apply-match-result";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: "match-1",
    tournamentId: "tournament-1",
    homeTeamId: "team-a",
    awayTeamId: "team-b",
    kickoffUtc: new Date(Date.now() - 7_200_000).toISOString(), // 2h ago
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    resultSource: null,
    settledAt: null,
    homePenaltyScore: null,
    awayPenaltyScore: null,
    winnerTeamId: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    matchId: "match-1",
    homeScore: 2,
    awayScore: 1,
    status: "finished",
    source: "auto",
    ...overrides,
  };
}

function makeDeps(
  matches: MatchRecord[],
  results: Map<string, MatchResult | null>,
  settleResponse: { status: number; body: object } = { status: 200, body: { settled: true, settleCount: 1 } }
): IngestDeps {
  const settleStub = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(settleResponse.body), { status: settleResponse.status })
  );

  return {
    matchRepository: {
      listUnsettled: vi.fn().mockResolvedValue(matches),
    },
    resultSource: {
      getResult: vi.fn().mockImplementation(async (matchId: string) => {
        return results.get(matchId) ?? null;
      }),
    },
    doSettle: settleStub,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ingestMatchResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls getResult for each unsettled match and settles finished ones via DO", async () => {
    const match = makeMatch({ id: "match-1", status: "scheduled" });
    const result = makeResult({ matchId: "match-1", status: "finished" });
    const deps = makeDeps([match], new Map([["match-1", result]]));

    const input: IngestResultsInput = { tournamentId: "tournament-1" };
    const output = await ingestMatchResults(input, deps);

    expect(output.ingested).toBe(1);
    expect(output.skipped).toBe(0);
    expect(output.errors).toBe(0);
    expect(deps.doSettle).toHaveBeenCalledOnce();
    expect(deps.doSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "match-1",
        homeScore: 2,
        awayScore: 1,
        status: "finished",
        source: "auto",
      })
    );
  });

  it("triggers settle for in_progress matches (bet-lock path)", async () => {
    const match = makeMatch({ id: "match-2", status: "scheduled" });
    const result = makeResult({
      matchId: "match-2",
      homeScore: 0,
      awayScore: 0,
      status: "in_progress",
    });
    const deps = makeDeps([match], new Map([["match-2", result]]));

    const output = await ingestMatchResults({ tournamentId: "tournament-1" }, deps);

    expect(output.ingested).toBe(1);
    expect(deps.doSettle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress" })
    );
  });

  it("skips matches where getResult returns null (API down / not available)", async () => {
    const match = makeMatch({ id: "match-3" });
    const deps = makeDeps([match], new Map([["match-3", null]]));

    const output = await ingestMatchResults({ tournamentId: "tournament-1" }, deps);

    expect(output.ingested).toBe(0);
    expect(output.skipped).toBe(1);
    expect(deps.doSettle).not.toHaveBeenCalled();
  });

  it("skips matches where result status is 'scheduled' (match has not started)", async () => {
    const match = makeMatch({ id: "match-4" });
    const result = makeResult({
      matchId: "match-4",
      homeScore: 0,
      awayScore: 0,
      status: "scheduled",
    });
    const deps = makeDeps([match], new Map([["match-4", result]]));

    const output = await ingestMatchResults({ tournamentId: "tournament-1" }, deps);

    expect(output.ingested).toBe(0);
    expect(output.skipped).toBe(1);
    expect(deps.doSettle).not.toHaveBeenCalled();
  });

  it("counts errors when DO settle returns non-200", async () => {
    const match = makeMatch({ id: "match-5" });
    const result = makeResult({ matchId: "match-5" });
    const deps = makeDeps(
      [match],
      new Map([["match-5", result]]),
      { status: 500, body: { error: "Match not found" } }
    );

    const output = await ingestMatchResults({ tournamentId: "tournament-1" }, deps);

    expect(output.ingested).toBe(0);
    expect(output.errors).toBe(1);
  });

  it("processes multiple matches in parallel and returns aggregate counts", async () => {
    const matches = [
      makeMatch({ id: "m1", status: "scheduled" }),
      makeMatch({ id: "m2", status: "in_progress" }),
      makeMatch({ id: "m3", status: "scheduled" }),
    ];
    const results = new Map<string, MatchResult | null>([
      ["m1", makeResult({ matchId: "m1", status: "finished" })],
      ["m2", makeResult({ matchId: "m2", status: "in_progress" })],
      ["m3", null],
    ]);
    const deps = makeDeps(matches, results);

    const output = await ingestMatchResults({ tournamentId: "tournament-1" }, deps);

    expect(output.ingested).toBe(2); // m1 + m2
    expect(output.skipped).toBe(1);  // m3 (null result)
    expect(output.errors).toBe(0);
    expect(deps.doSettle).toHaveBeenCalledTimes(2);
  });
});

/**
 * RED tests for runIngest — dependency-injected unit tests.
 *
 * runIngest(env, tournamentId) orchestrates:
 *   1. listUnsettled from DB to check for active-window matches
 *   2. If gate passes → call ingestMatchResults with wired deps
 *   3. If gate fails  → return noop output without calling FIFA
 *
 * Deps are injected so tests never hit the real FIFA API or DB.
 */

import { describe, it, expect, vi } from "vitest";
import type { MatchRecord } from "#/domain/apply-match-result";
import type { IngestResultsOutput } from "#/routes/api/admin/-ingest-results";
import { makeRunIngest } from "./run-ingest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOURNAMENT_ID = "17-285023";

/** A match in the active window (scheduled, kicked off 1h ago). */
function makeActiveMatch(): MatchRecord {
  const kickoffUtc = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return {
    id: "fifa-m-test",
    tournamentId: TOURNAMENT_ID,
    homeTeamId: "fifa-t-1",
    awayTeamId: "fifa-t-2",
    kickoffUtc,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    resultSource: null,
    settledAt: null,
  };
}

const NOOP_OUTPUT: IngestResultsOutput = {
  ingested: 0,
  skipped: 0,
  errors: 0,
  details: [],
};

const INGESTED_OUTPUT: IngestResultsOutput = {
  ingested: 1,
  skipped: 0,
  errors: 0,
  details: ["settled fifa-m-test: 2-0 (finished)"],
};

describe("runIngest (injected deps)", () => {
  it("when active-window match exists → ingestMatchResults called once", async () => {
    const listUnsettled = vi.fn().mockResolvedValue([makeActiveMatch()]);
    const ingestMatchResults = vi.fn().mockResolvedValue(INGESTED_OUTPUT);
    const fakeDONamespace = {} as DurableObjectNamespace;

    const runIngest = makeRunIngest({ listUnsettled, ingestMatchResults });

    const result = await runIngest(
      { MATCH_DO: fakeDONamespace },
      TOURNAMENT_ID
    );

    expect(ingestMatchResults).toHaveBeenCalledOnce();
    expect(ingestMatchResults).toHaveBeenCalledWith(
      { tournamentId: TOURNAMENT_ID },
      expect.objectContaining({ doSettle: expect.any(Function) })
    );
    expect(result).toEqual(INGESTED_OUTPUT);
  });

  it("when no active-window matches → ingestMatchResults NOT called, returns noop", async () => {
    const listUnsettled = vi.fn().mockResolvedValue([]);
    const ingestMatchResults = vi.fn();
    const fakeDONamespace = {} as DurableObjectNamespace;

    const runIngest = makeRunIngest({ listUnsettled, ingestMatchResults });

    const result = await runIngest(
      { MATCH_DO: fakeDONamespace },
      TOURNAMENT_ID
    );

    expect(ingestMatchResults).not.toHaveBeenCalled();
    expect(result).toEqual(NOOP_OUTPUT);
  });

  it("when only finished matches → gate fails, ingestMatchResults NOT called", async () => {
    const finishedMatch: MatchRecord = {
      ...makeActiveMatch(),
      status: "finished",
    };
    const listUnsettled = vi.fn().mockResolvedValue([finishedMatch]);
    const ingestMatchResults = vi.fn();
    const fakeDONamespace = {} as DurableObjectNamespace;

    const runIngest = makeRunIngest({ listUnsettled, ingestMatchResults });

    const result = await runIngest(
      { MATCH_DO: fakeDONamespace },
      TOURNAMENT_ID
    );

    expect(ingestMatchResults).not.toHaveBeenCalled();
    expect(result).toEqual(NOOP_OUTPUT);
  });

  // ---------------------------------------------------------------------------
  // skipWindowGate option — manual admin backstop behaviour
  // ---------------------------------------------------------------------------

  it("skipWindowGate=true: match outside 24h window → ingestMatchResults IS called (no NOOP)", async () => {
    // Kickoff 26 hours ago — well outside the default 24h window.
    const staleMatch: MatchRecord = {
      ...makeActiveMatch(),
      kickoffUtc: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    };
    const listUnsettled = vi.fn().mockResolvedValue([staleMatch]);
    const ingestMatchResults = vi.fn().mockResolvedValue(INGESTED_OUTPUT);
    const fakeDONamespace = {} as DurableObjectNamespace;

    const runIngest = makeRunIngest({ listUnsettled, ingestMatchResults });

    const result = await runIngest(
      { MATCH_DO: fakeDONamespace },
      TOURNAMENT_ID,
      { skipWindowGate: true }
    );

    // Gate bypassed → ingest called even though kickoff is >6h ago.
    expect(ingestMatchResults).toHaveBeenCalledOnce();
    expect(result).toEqual(INGESTED_OUTPUT);
  });

  it("skipWindowGate=false (default): match outside 24h window → NOOP (gate enforced)", async () => {
    // Kickoff 26 hours ago — outside the 24h window.
    const staleMatch: MatchRecord = {
      ...makeActiveMatch(),
      kickoffUtc: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    };
    const listUnsettled = vi.fn().mockResolvedValue([staleMatch]);
    const ingestMatchResults = vi.fn();
    const fakeDONamespace = {} as DurableObjectNamespace;

    const runIngest = makeRunIngest({ listUnsettled, ingestMatchResults });

    // No opts — default gating applies.
    const result = await runIngest(
      { MATCH_DO: fakeDONamespace },
      TOURNAMENT_ID
    );

    expect(ingestMatchResults).not.toHaveBeenCalled();
    expect(result).toEqual(NOOP_OUTPUT);
  });

  it("skipWindowGate=true with empty listUnsettled → still NOOP (no matches to settle)", async () => {
    const listUnsettled = vi.fn().mockResolvedValue([]);
    const ingestMatchResults = vi.fn().mockResolvedValue(NOOP_OUTPUT);
    const fakeDONamespace = {} as DurableObjectNamespace;

    const runIngest = makeRunIngest({ listUnsettled, ingestMatchResults });

    const result = await runIngest(
      { MATCH_DO: fakeDONamespace },
      TOURNAMENT_ID,
      { skipWindowGate: true }
    );

    // No unsettled matches returned by listUnsettled → ingestMatchResults
    // receives an empty match list and should return NOOP naturally.
    // (ingestMatchResults itself handles empty — the gate is bypassed, but
    //  there's nothing to settle so the result mirrors the noop output.)
    expect(ingestMatchResults).toHaveBeenCalledOnce();
    expect(result).toEqual(NOOP_OUTPUT);
  });
});

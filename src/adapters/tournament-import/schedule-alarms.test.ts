/**
 * RED tests for scheduleImportAlarms — written BEFORE implementation.
 *
 * scheduleImportAlarms(structure, env) → Promise<void>
 *   For each match in structure.matches, POSTs to the MATCH_DO stub at
 *   "http://do/schedule-alarm" with { matchId, kickoffUtc }.
 *   No reminderOffsetMs in the payload (settlement-only alarm at kickoff+150min).
 *   Idempotent at the DO level (setAlarm replaces; re-import re-sets same deadline).
 *
 * importTournament signature stays (structure, db) — env-free, unchanged.
 */

import { describe, it, expect, vi } from "vitest";
import { scheduleImportAlarms } from "./schedule-alarms";
import type { TournamentStructure } from "#/domain/ports/tournament-source";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STRUCTURE: TournamentStructure = {
  tournamentId: "17-285023",
  name: "FIFA World Cup 2026™",
  teams: [],
  matches: [
    {
      id: "fifa-m-1",
      homeTeamId: "fifa-t-1",
      awayTeamId: "fifa-t-2",
      kickoffUtc: "2026-06-14T16:00:00.000Z",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      group: "Group A",
      stage: "289273",
    },
    {
      id: "fifa-m-2",
      homeTeamId: "fifa-t-3",
      awayTeamId: "fifa-t-4",
      kickoffUtc: "2026-06-15T19:00:00.000Z",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      group: "Group B",
      stage: "289273",
    },
  ],
};

// ---------------------------------------------------------------------------
// Fake DurableObjectNamespace stub
// ---------------------------------------------------------------------------

function makeFakeDONamespace() {
  const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  const getStub = vi.fn().mockReturnValue({
    fetch: fetchStub,
  });
  const idFromNameStub = vi.fn((name: string) => ({ name } as unknown as DurableObjectId));

  const namespace = {
    idFromName: idFromNameStub,
    get: getStub,
  } as unknown as DurableObjectNamespace;

  return { namespace, fetchStub, getStub, idFromNameStub };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scheduleImportAlarms", () => {
  it("calls MATCH_DO.get().fetch for each match in structure", async () => {
    const { namespace, fetchStub } = makeFakeDONamespace();

    await scheduleImportAlarms(STRUCTURE, { MATCH_DO: namespace });

    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("calls fetch with correct matchId and kickoffUtc, no reminderOffsetMs", async () => {
    const { namespace, fetchStub } = makeFakeDONamespace();

    await scheduleImportAlarms(STRUCTURE, { MATCH_DO: namespace });

    const [call1, call2] = fetchStub.mock.calls;

    const body1 = JSON.parse(call1[1].body as string) as Record<string, unknown>;
    expect(body1["matchId"]).toBe("fifa-m-1");
    expect(body1["kickoffUtc"]).toBe("2026-06-14T16:00:00.000Z");
    expect(body1["reminderOffsetMs"]).toBeUndefined();

    const body2 = JSON.parse(call2[1].body as string) as Record<string, unknown>;
    expect(body2["matchId"]).toBe("fifa-m-2");
    expect(body2["kickoffUtc"]).toBe("2026-06-15T19:00:00.000Z");
    expect(body2["reminderOffsetMs"]).toBeUndefined();
  });

  it("fetch is POSTed to http://do/schedule-alarm", async () => {
    const { namespace, fetchStub } = makeFakeDONamespace();

    await scheduleImportAlarms(STRUCTURE, { MATCH_DO: namespace });

    for (const call of fetchStub.mock.calls) {
      expect(call[0]).toBe("http://do/schedule-alarm");
      expect(call[1].method).toBe("POST");
    }
  });

  it("re-import (same structure) → stub called again (idempotent via setAlarm replace at DO level)", async () => {
    const { namespace, fetchStub } = makeFakeDONamespace();

    await scheduleImportAlarms(STRUCTURE, { MATCH_DO: namespace });
    await scheduleImportAlarms(STRUCTURE, { MATCH_DO: namespace });

    // 2 matches × 2 calls = 4 total; no deduplication in caller
    expect(fetchStub).toHaveBeenCalledTimes(4);
  });
});

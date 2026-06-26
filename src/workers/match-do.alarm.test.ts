/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * TDD 3.6 (RED): MatchDO alarm() safety-net tests.
 *
 * Spec (result-triggering):
 *  - Safety-net alarm fires at kickoff + 150 min, exactly once per match
 *  - If the match is NOT yet settled: alarm calls settle (dispatches to applyMatchResult)
 *  - If the match IS already settled: alarm is a no-op (settled flag checked first)
 *  - Alarm does NOT reschedule itself after firing
 *
 * Strategy: we trigger alarm() via POST /alarm (test helper endpoint on the DO).
 * The DO must:
 *   1. Expose a POST /alarm route that calls the alarm() handler (testability hook)
 *   2. alarm() checks the "settled" flag in DO storage before calling settle logic
 *   3. alarm() clears any scheduled alarm after firing (no reschedule)
 *
 * We use the workers vitest pool (real workerd runtime) — mock DO is NOT acceptable.
 * TURSO_DATABASE_URL is set to "" in test bindings, so the DB path is skipped.
 */

import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Env } from "./match-do";

const testEnv = env as Env;

describe("MatchDO — alarm() safety-net", () => {
  it("alarm fires settle logic when match is not yet settled", async () => {
    const matchId = `alarm-unsettled-${Date.now()}`;
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    // Trigger alarm via the DO's /alarm test endpoint (no prior settle)
    const response = await stub.fetch("http://do/alarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId,
        homeScore: 1,
        awayScore: 0,
        status: "finished",
        source: "auto",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json<{ alarmFired: boolean; settled: boolean; settleCount: number }>();
    expect(body.alarmFired).toBe(true);
    expect(body.settled).toBe(true);
    // Settlement ran exactly once
    expect(body.settleCount).toBe(1);
  });

  it("alarm is a no-op when match is already settled (settled guard)", async () => {
    const matchId = `alarm-already-settled-${Date.now()}`;
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    // Settle first via the normal /settle route
    const settleResponse = await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId,
        homeScore: 2,
        awayScore: 0,
        status: "finished",
        source: "auto",
      }),
    });
    expect(settleResponse.status).toBe(200);
    const { settleCount: countAfterFirst } = await settleResponse.json<{ settleCount: number }>();
    expect(countAfterFirst).toBe(1);

    // Now fire the alarm — must be a no-op (settleCount stays 1)
    const alarmResponse = await stub.fetch("http://do/alarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId,
        homeScore: 2,
        awayScore: 0,
        status: "finished",
        source: "auto",
      }),
    });

    expect(alarmResponse.status).toBe(200);
    const body = await alarmResponse.json<{ alarmFired: boolean; settled: boolean; settleCount: number }>();
    expect(body.alarmFired).toBe(false); // no-op: already settled
    expect(body.settled).toBe(true);
    expect(body.settleCount).toBe(1); // still 1 — did not re-settle
  });

  it("schedule-alarm endpoint stores kickoffUtc+150min alarm in DO storage", async () => {
    const matchId = `alarm-schedule-${Date.now()}`;
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    const kickoffUtc = "2026-07-01T18:00:00.000Z"; // June 1, 2026 18:00 UTC
    const expectedAlarmAt = new Date("2026-07-01T18:00:00.000Z").getTime() + 150 * 60 * 1000;

    const response = await stub.fetch("http://do/schedule-alarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, kickoffUtc }),
    });

    expect(response.status).toBe(200);
    const body = await response.json<{ alarmScheduledAt: number }>();
    expect(body.alarmScheduledAt).toBe(expectedAlarmAt);
  });
});

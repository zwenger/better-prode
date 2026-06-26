/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * TDD 5.6 (RED): MatchDO reminder alarm tests.
 *
 * Spec (reminders):
 *  - Reminder alarm fires at kickoff − 30min (before the settlement alarm)
 *  - When reminder fires, push notifications are sent only to non-predictors
 *  - Already-predicted users are skipped
 *  - Users with no push subscription are skipped (silent)
 *  - After the reminder fires, the settlement alarm (kickoff+150min) is
 *    re-scheduled so both alarms complete correctly despite DO's single alarm slot
 *
 * Spec (testability):
 *  - The DO must expose a test-only endpoint (/reminder-alarm) that triggers
 *    the reminder alarm logic directly (mirrors the /alarm endpoint for settlement)
 *
 * Strategy:
 *  - We use the workers vitest pool (real workerd runtime)
 *  - Push sending is mocked via DO env bindings (TURSO_DATABASE_URL="", so
 *    DB is skipped). The reminder logic path must work without DB.
 *  - We pass a fake sender via JSON body (non-predictor IDs + "sent" flag test)
 *  - The DO exposes /reminder-alarm?nonPredictors=user1,user2 for test control
 *
 * Single alarm slot design:
 *  The DO's alarm() handler checks `nextAlarmType` in storage:
 *    - "reminder" → run reminder logic, reschedule settlement alarm
 *    - "settlement" (or undefined/null) → run settlement logic (existing behavior)
 *  /schedule-alarm now accepts `reminderOffsetMs` and schedules the REMINDER
 *  alarm first (kickoff - 30min). The settlement alarm is then scheduled by the
 *  reminder handler after it fires.
 */

import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Env } from "./match-do";

const testEnv = env as Env;

describe("MatchDO — reminder alarm", () => {
  it("reminder alarm fires and sends push to non-predictors (test endpoint)", async () => {
    const matchId = `reminder-nonpredictors-${Date.now()}`;
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    // Fire the reminder alarm via the test endpoint.
    // We pass non-predictor user IDs in the body so the DO can simulate sends
    // without a real DB connection (TURSO_DATABASE_URL="").
    const response = await stub.fetch("http://do/reminder-alarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId,
        kickoffUtc: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // kickoff in 30min
        nonPredictorUserIds: ["user-a", "user-b"],
        predictorUserIds: [],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json<{
      reminderFired: boolean;
      pushSentCount: number;
      settlementAlarmScheduled: boolean;
    }>();

    expect(body.reminderFired).toBe(true);
    // In the test env with no DB, we expect the count to reflect the non-predictors passed
    expect(body.pushSentCount).toBe(2); // both user-a and user-b
    expect(body.settlementAlarmScheduled).toBe(true);
  });

  it("reminder alarm skips already-predicted users", async () => {
    const matchId = `reminder-skip-predictors-${Date.now()}`;
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    const response = await stub.fetch("http://do/reminder-alarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId,
        kickoffUtc: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        nonPredictorUserIds: [], // everyone predicted
        predictorUserIds: ["user-a", "user-b"],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json<{
      reminderFired: boolean;
      pushSentCount: number;
      settlementAlarmScheduled: boolean;
    }>();

    expect(body.reminderFired).toBe(true);
    expect(body.pushSentCount).toBe(0); // no non-predictors → no push
    expect(body.settlementAlarmScheduled).toBe(true);
  });

  it("schedule-alarm with reminderOffsetMs schedules reminder first, then settlement", async () => {
    const matchId = `reminder-schedule-${Date.now()}`;
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    const kickoffUtc = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // kickoff in 1h
    const expectedReminderAt =
      new Date(kickoffUtc).getTime() - 30 * 60 * 1000; // kickoff - 30min

    const response = await stub.fetch("http://do/schedule-alarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId,
        kickoffUtc,
        homeScore: 0,
        awayScore: 0,
        status: "scheduled",
        source: "auto",
        reminderOffsetMs: 30 * 60 * 1000, // 30min before kickoff
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json<{
      alarmScheduledAt: number;
      nextAlarmType: string;
    }>();

    // The alarm scheduled first should be the reminder (kickoff - 30min)
    expect(body.alarmScheduledAt).toBe(expectedReminderAt);
    expect(body.nextAlarmType).toBe("reminder");
  });

  it("existing settlement alarm tests still pass after reminder changes", async () => {
    // Regression: the existing alarm() (settlement path) must still work when
    // nextAlarmType is not set (defaults to settlement behavior).
    const matchId = `regression-settlement-${Date.now()}`;
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    // Trigger the settlement alarm (no nextAlarmType stored → defaults to settlement)
    const response = await stub.fetch("http://do/alarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId,
        homeScore: 2,
        awayScore: 1,
        status: "finished",
        source: "auto",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json<{
      alarmFired: boolean;
      settled: boolean;
      settleCount: number;
    }>();
    expect(body.alarmFired).toBe(true);
    expect(body.settled).toBe(true);
    expect(body.settleCount).toBe(1);
  });
});

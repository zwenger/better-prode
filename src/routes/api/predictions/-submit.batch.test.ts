/**
 * Integration tests for submitBatchPredictions — uses in-memory libSQL
 * (same pattern as submit-prediction.test.ts).
 *
 * Covers:
 *  - All predictions succeed (all-saved)
 *  - Partial lock — one match locked, others saved
 *  - Idempotent re-submit — same values → success (no conflict)
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "#/adapters/db/test-helpers";
import { DrizzleMatchRepository } from "#/adapters/db/match-repository";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import type { DrizzleDb } from "#/infra/db/client";
import { FakeClock } from "#/domain/ports/clock";
import { submitPredictionCore } from "#/domain/submit-prediction";
import { aggregateBatchResults } from "#/app/aggregate-batch-results";
import type { PerMatchResult } from "#/app/aggregate-batch-results";

/**
 * submitBatchPredictionsCore — testable core of the batch server fn,
 * extracted so it can be integration-tested without the auth/request plumbing.
 */
async function submitBatchPredictionsCore(opts: {
  userId: string;
  predictions: Array<{ matchId: string; homeGoals: number; awayGoals: number }>;
  matchRepo: DrizzleMatchRepository;
  predRepo: DrizzlePredictionRepository;
  clock: FakeClock;
}): Promise<{ results: Record<string, PerMatchResult> }> {
  const { userId, predictions, matchRepo, predRepo, clock } = opts;

  const settled = await Promise.allSettled(
    predictions.map((p) =>
      submitPredictionCore({
        userId,
        input: { matchId: p.matchId, homeGoals: p.homeGoals, awayGoals: p.awayGoals },
        matchRepo,
        predRepo,
        clock,
      })
    )
  );

  const results: Record<string, PerMatchResult> = {};
  for (const [i, outcome] of settled.entries()) {
    const matchId = predictions[i].matchId;
    if (outcome.status === "fulfilled") {
      results[matchId] = { status: "saved" };
    } else {
      const err = outcome.reason as { status?: number; message?: string };
      if (err.status === 422) {
        results[matchId] = { status: "locked", message: "match_locked" };
      } else {
        results[matchId] = { status: "error", message: err.message ?? "Unknown error" };
      }
    }
  }

  return { results };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const USER_ID = "u-batch-test";
const FUTURE_KICKOFF = "2026-09-01T20:00:00.000Z";
const PAST_KICKOFF = "2020-01-01T00:00:00.000Z"; // always locked
const BEFORE_FUTURE = new Date("2026-08-01T00:00:00.000Z"); // not locked for FUTURE_KICKOFF

const MATCH_A = "m-batch-a";
const MATCH_B = "m-batch-b";
const MATCH_C = "m-batch-c";
const MATCH_LOCKED = "m-batch-locked";

let db: DrizzleDb & { $client: Client };
let matchRepo: DrizzleMatchRepository;
let predRepo: DrizzlePredictionRepository;

async function seed(client: Client): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO tournament(id, name, created_at) VALUES (?, ?, ?)`,
    args: ["t-batch", "Batch Tournament", now],
  });
  for (const code of ["HA", "AA", "HB", "AB", "HC", "AC", "HL", "AL"]) {
    await client.execute({
      sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
      args: [`${code}-batch`, "t-batch", `Team ${code}`, code],
    });
  }
  // Three unlocked matches
  const unlocked: [string, string, string][] = [
    [MATCH_A, "HA-batch", "AA-batch"],
    [MATCH_B, "HB-batch", "AB-batch"],
    [MATCH_C, "HC-batch", "AC-batch"],
  ];
  for (const [id, home, away] of unlocked) {
    await client.execute({
      sql: `INSERT INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, "t-batch", home, away, FUTURE_KICKOFF, "scheduled", now],
    });
  }
  // One locked match (past kickoff)
  await client.execute({
    sql: `INSERT INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [MATCH_LOCKED, "t-batch", "HL-batch", "AL-batch", PAST_KICKOFF, "scheduled", now],
  });
  // Test user
  await client.execute({
    sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`,
    args: [USER_ID, "Batch Tester", "batch@test.com", now, now],
  });
}

describe("submitBatchPredictions (core) — integration against in-memory libSQL", () => {
  beforeEach(async () => {
    db = await createTestDb();
    matchRepo = new DrizzleMatchRepository(db);
    predRepo = new DrizzlePredictionRepository(db);
    await seed(db.$client);
  });

  it("saves all 3 predictions when all matches are unlocked", async () => {
    const clock = new FakeClock(BEFORE_FUTURE);

    const { results } = await submitBatchPredictionsCore({
      userId: USER_ID,
      predictions: [
        { matchId: MATCH_A, homeGoals: 1, awayGoals: 0 },
        { matchId: MATCH_B, homeGoals: 2, awayGoals: 2 },
        { matchId: MATCH_C, homeGoals: 0, awayGoals: 3 },
      ],
      matchRepo,
      predRepo,
      clock,
    });

    expect(results[MATCH_A].status).toBe("saved");
    expect(results[MATCH_B].status).toBe("saved");
    expect(results[MATCH_C].status).toBe("saved");

    const summary = aggregateBatchResults(results);
    expect(summary.saved).toBe(3);
    expect(summary.locked).toBe(0);
    expect(summary.error).toBe(0);
    expect(summary.total).toBe(3);

    // Verify all three rows actually persisted in the DB
    const savedA = await predRepo.listByMatch(MATCH_A);
    expect(savedA).toHaveLength(1);
    expect(savedA.at(0)?.homeGoals).toBe(1);
    expect(savedA.at(0)?.awayGoals).toBe(0);

    const savedB = await predRepo.listByMatch(MATCH_B);
    expect(savedB).toHaveLength(1);
    expect(savedB.at(0)?.homeGoals).toBe(2);

    const savedC = await predRepo.listByMatch(MATCH_C);
    expect(savedC).toHaveLength(1);
    expect(savedC.at(0)?.awayGoals).toBe(3);
  });

  it("reports locked for the locked match, saves the remaining two", async () => {
    const clock = new FakeClock(BEFORE_FUTURE);

    const { results } = await submitBatchPredictionsCore({
      userId: USER_ID,
      predictions: [
        { matchId: MATCH_A, homeGoals: 1, awayGoals: 0 },
        { matchId: MATCH_LOCKED, homeGoals: 2, awayGoals: 1 }, // will be locked
        { matchId: MATCH_C, homeGoals: 0, awayGoals: 1 },
      ],
      matchRepo,
      predRepo,
      clock,
    });

    expect(results[MATCH_A].status).toBe("saved");
    expect(results[MATCH_LOCKED].status).toBe("locked");
    expect(results[MATCH_C].status).toBe("saved");

    const summary = aggregateBatchResults(results);
    expect(summary.saved).toBe(2);
    expect(summary.locked).toBe(1);
    expect(summary.error).toBe(0);
    expect(summary.total).toBe(3);

    // Locked match must NOT have been persisted
    const lockedPreds = await predRepo.listByMatch(MATCH_LOCKED);
    expect(lockedPreds).toHaveLength(0);

    // Unlocked matches WERE persisted
    const savedA = await predRepo.listByMatch(MATCH_A);
    expect(savedA).toHaveLength(1);
  });

  it("idempotent re-submit: same values saved again → still reports saved", async () => {
    const clock = new FakeClock(BEFORE_FUTURE);

    // First batch
    await submitBatchPredictionsCore({
      userId: USER_ID,
      predictions: [{ matchId: MATCH_A, homeGoals: 2, awayGoals: 1 }],
      matchRepo,
      predRepo,
      clock,
    });

    // Second batch — same values
    const { results } = await submitBatchPredictionsCore({
      userId: USER_ID,
      predictions: [{ matchId: MATCH_A, homeGoals: 2, awayGoals: 1 }],
      matchRepo,
      predRepo,
      clock,
    });

    expect(results[MATCH_A].status).toBe("saved");

    // Still only one row in DB (upsert, not duplicate)
    const saved = await predRepo.listByMatch(MATCH_A);
    expect(saved).toHaveLength(1);
    expect(saved.at(0)?.homeGoals).toBe(2);
    expect(saved.at(0)?.awayGoals).toBe(1);
  });
});

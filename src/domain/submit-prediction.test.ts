import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "#/adapters/db/test-helpers";
import { DrizzleMatchRepository } from "#/adapters/db/match-repository";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import type { DrizzleDb } from "#/infra/db/client";
import { FakeClock } from "#/domain/ports/clock";
import { submitPredictionCore } from "./submit-prediction";

/**
 * Integration tests for the submit-prediction core against a REAL in-memory
 * libSQL DB. These assert that submitting actually PERSISTS the prediction with
 * the correct scores (read back from the DB), and that a locked match is
 * rejected without persisting anything.
 */

const MATCH_ID = "m-submit-test";
const USER_ID = "u-submit-test";
const KICKOFF = "2026-07-15T20:00:00.000Z";
const BEFORE_KICKOFF = new Date("2026-07-15T00:00:00.000Z"); // not locked
const AT_KICKOFF = new Date(KICKOFF); // locked (now >= kickoff − 5min)

let db: DrizzleDb & { $client: Client };
let matchRepo: DrizzleMatchRepository;
let predRepo: DrizzlePredictionRepository;

async function seed(client: Client): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO tournament(id, name, created_at) VALUES (?, ?, ?)`,
    args: ["t-st", "Test Tournament", now],
  });
  await client.execute({
    sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
    args: ["h-st", "t-st", "Home", "HOM"],
  });
  await client.execute({
    sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
    args: ["a-st", "t-st", "Away", "AWY"],
  });
  await client.execute({
    sql: `INSERT INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [MATCH_ID, "t-st", "h-st", "a-st", KICKOFF, "scheduled", now],
  });
  await client.execute({
    sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`,
    args: [USER_ID, "Tester", "tester@test.com", now, now],
  });
}

describe("submitPredictionCore — persists the prediction end-to-end", () => {
  beforeEach(async () => {
    db = await createTestDb();
    matchRepo = new DrizzleMatchRepository(db);
    predRepo = new DrizzlePredictionRepository(db);
    await seed(db.$client);
  });

  it("saves the submitted scores — and they are READ BACK from the DB", async () => {
    const clock = new FakeClock(BEFORE_KICKOFF);

    const res = await submitPredictionCore({
      userId: USER_ID,
      input: { matchId: MATCH_ID, homeGoals: 2, awayGoals: 1 },
      matchRepo,
      predRepo,
      clock,
    });

    expect(res.success).toBe(true);
    expect(res.predictionId).toBeTruthy();

    // The real assertion: query the DB and confirm the row persisted correctly.
    const saved = await predRepo.listByMatch(MATCH_ID);
    expect(saved).toHaveLength(1);
    expect(saved[0].userId).toBe(USER_ID);
    expect(saved[0].homeGoals).toBe(2);
    expect(saved[0].awayGoals).toBe(1);
    expect(saved[0].points).toBeNull();
  });

  it("re-submitting updates the stored prediction (no duplicate row)", async () => {
    const clock = new FakeClock(BEFORE_KICKOFF);
    await submitPredictionCore({
      userId: USER_ID,
      input: { matchId: MATCH_ID, homeGoals: 2, awayGoals: 1 },
      matchRepo,
      predRepo,
      clock,
    });
    await submitPredictionCore({
      userId: USER_ID,
      input: { matchId: MATCH_ID, homeGoals: 0, awayGoals: 3 },
      matchRepo,
      predRepo,
      clock,
    });

    const saved = await predRepo.listByMatch(MATCH_ID);
    expect(saved).toHaveLength(1);
    expect(saved[0].homeGoals).toBe(0);
    expect(saved[0].awayGoals).toBe(3);
  });

  it("rejects with 422 and persists NOTHING when the match is locked", async () => {
    const clock = new FakeClock(AT_KICKOFF);

    await expect(
      submitPredictionCore({
        userId: USER_ID,
        input: { matchId: MATCH_ID, homeGoals: 2, awayGoals: 1 },
        matchRepo,
        predRepo,
        clock,
      })
    ).rejects.toThrow("match_locked");

    const saved = await predRepo.listByMatch(MATCH_ID);
    expect(saved).toHaveLength(0);
  });

  it("throws when the match does not exist", async () => {
    const clock = new FakeClock(BEFORE_KICKOFF);
    await expect(
      submitPredictionCore({
        userId: USER_ID,
        input: { matchId: "does-not-exist", homeGoals: 1, awayGoals: 0 },
        matchRepo,
        predRepo,
        clock,
      })
    ).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// TBD match guard (spec: Predictable Gate — Server rejects prediction for TBD match)
// ---------------------------------------------------------------------------

describe("submitPredictionCore — TBD match guard (predictable gate)", () => {
  const TBD_MATCH_ID = "m-tbd-guard";

  beforeEach(async () => {
    db = await createTestDb();
    matchRepo = new DrizzleMatchRepository(db);
    predRepo = new DrizzlePredictionRepository(db);
    const now = new Date().toISOString();

    await db.$client.execute({
      sql: `INSERT INTO tournament(id, name, created_at) VALUES (?, ?, ?)`,
      args: ["t-tbd", "Test Tournament", now],
    });
    await db.$client.execute({
      sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`,
      args: [USER_ID, "Tester", "tester@test.com", now, now],
    });
    // Insert TBD match — both team IDs null
    await db.$client.execute({
      sql: `INSERT INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, home_placeholder, away_placeholder, created_at)
            VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
      args: [TBD_MATCH_ID, "t-tbd", KICKOFF, "scheduled", "W74", "RU101", now],
    });
  });

  it("rejects with status 422 and persists NO prediction when homeTeamId is null", async () => {
    const clock = new FakeClock(BEFORE_KICKOFF);

    await expect(
      submitPredictionCore({
        userId: USER_ID,
        input: { matchId: TBD_MATCH_ID, homeGoals: 2, awayGoals: 1 },
        matchRepo,
        predRepo,
        clock,
      })
      // Pin EXACTLY 422 — the client branches on this status code.
    ).rejects.toMatchObject({ status: 422 });

    const saved = await predRepo.listByMatch(TBD_MATCH_ID);
    expect(saved).toHaveLength(0);
  });

  it("error message indicates TBD/not-predictable condition", async () => {
    const clock = new FakeClock(BEFORE_KICKOFF);

    await expect(
      submitPredictionCore({
        userId: USER_ID,
        input: { matchId: TBD_MATCH_ID, homeGoals: 1, awayGoals: 0 },
        matchRepo,
        predRepo,
        clock,
      })
    ).rejects.toThrow(/tbd|not.?predictable|teams.*not.*confirmed/i);
  });
});

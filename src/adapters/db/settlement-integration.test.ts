/**
 * Integration tests: applyMatchResult through real Drizzle repositories
 * against an in-memory libSQL database.
 *
 * These tests cover the Phase-4 DB-settlement behaviour that was previously
 * exercised in the workers pool (match-do.test.ts) against a remote Turso DB.
 * Running against :memory: ensures complete isolation — no remote connections,
 * no leftover rows, no production credentials required.
 *
 * Scenarios covered:
 *  - finished settle writes result to DB (status, scores, resultSource, settledAt)
 *  - in_progress settle updates match.status to in_progress (bet-lock path)
 *  - match not found in DB → applyMatchResult throws "Match not found"
 *  - DB-level idempotency: second finished settle with same score is no-op
 */

import { describe, it, expect, beforeEach } from "vitest";
import { applyMatchResult } from "#/domain/apply-match-result";
import { DrizzleMatchRepository } from "#/adapters/db/match-repository";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import { SystemClock } from "#/domain/ports/clock";
import { createTestDb } from "#/adapters/db/test-helpers";
import type { DrizzleDb } from "#/infra/db/client";
import type { Client } from "@libsql/client";

// ---------------------------------------------------------------------------
// Test helpers — seed minimal rows for applyMatchResult to operate on
// ---------------------------------------------------------------------------

const TOURNAMENT_ID = "t-integ-settlement";
const HOME_TEAM_ID  = "team-integ-home";
const AWAY_TEAM_ID  = "team-integ-away";

type TestDb = DrizzleDb & { $client: Client };

async function seedMatch(db: TestDb, matchId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.$client.execute({
    sql: `INSERT OR IGNORE INTO tournament (id, name, created_at) VALUES (?, ?, ?)`,
    args: [TOURNAMENT_ID, "Settlement Integration Tournament", now],
  });
  await db.$client.execute({
    sql: `INSERT OR IGNORE INTO team (id, tournament_id, name) VALUES (?, ?, ?)`,
    args: [HOME_TEAM_ID, TOURNAMENT_ID, "Home FC"],
  });
  await db.$client.execute({
    sql: `INSERT OR IGNORE INTO team (id, tournament_id, name) VALUES (?, ?, ?)`,
    args: [AWAY_TEAM_ID, TOURNAMENT_ID, "Away FC"],
  });
  await db.$client.execute({
    sql: `INSERT OR REPLACE INTO match
            (id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'scheduled', ?)`,
    args: [
      matchId,
      TOURNAMENT_ID,
      HOME_TEAM_ID,
      AWAY_TEAM_ID,
      new Date(Date.now() - 7_200_000).toISOString(), // 2h ago
      now,
    ],
  });
}

async function fetchMatchRow(
  db: TestDb,
  matchId: string
): Promise<Record<string, unknown> | null> {
  const result = await db.$client.execute({
    sql: `SELECT id, status, home_score, away_score, result_source, settled_at FROM match WHERE id = ?`,
    args: [matchId],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row[0],
    status: row[1],
    homeScore: row[2],
    awayScore: row[3],
    resultSource: row[4],
    settledAt: row[5],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyMatchResult — DB-settlement integration (in-memory libSQL)", () => {
  let db: TestDb;

  beforeEach(async () => {
    // Each test gets a fresh in-memory DB with full schema applied.
    db = await createTestDb();
  });

  it("finished settle writes result to DB (status, scores, resultSource, settledAt)", async () => {
    const matchId = "integ-finished-settle";
    await seedMatch(db, matchId);

    const matchRepository = new DrizzleMatchRepository(db);
    const predictionRepository = new DrizzlePredictionRepository(db);

    await applyMatchResult(
      { matchId, homeScore: 3, awayScore: 1, status: "finished", source: "auto" },
      { matchRepository, predictionRepository },
      new SystemClock()
    );

    const row = await fetchMatchRow(db, matchId);
    expect(row).not.toBeNull();
    expect(row!["status"]).toBe("finished");
    expect(row!["homeScore"]).toBe(3);
    expect(row!["awayScore"]).toBe(1);
    expect(row!["resultSource"]).toBe("auto");
    expect(row!["settledAt"]).not.toBeNull();
  });

  it("in_progress settle updates match.status to in_progress (bet-lock path)", async () => {
    const matchId = "integ-inprog-settle";
    await seedMatch(db, matchId);

    const matchRepository = new DrizzleMatchRepository(db);
    const predictionRepository = new DrizzlePredictionRepository(db);

    await applyMatchResult(
      { matchId, homeScore: 0, awayScore: 0, status: "in_progress", source: "auto" },
      { matchRepository, predictionRepository },
      new SystemClock()
    );

    const row = await fetchMatchRow(db, matchId);
    expect(row).not.toBeNull();
    expect(row!["status"]).toBe("in_progress");
    // settledAt must NOT be set for in_progress (not yet fully settled)
    expect(row!["settledAt"]).toBeNull();
  });

  it("match not found → applyMatchResult throws 'Match not found'", async () => {
    const matchId = "integ-not-found";
    // Intentionally NOT seeded

    const matchRepository = new DrizzleMatchRepository(db);
    const predictionRepository = new DrizzlePredictionRepository(db);

    await expect(
      applyMatchResult(
        { matchId, homeScore: 1, awayScore: 0, status: "finished", source: "auto" },
        { matchRepository, predictionRepository },
        new SystemClock()
      )
    ).rejects.toThrow(/not found/i);
  });

  it("DB-level idempotency: second finished settle with same score skips updateResult", async () => {
    const matchId = "integ-idem-settle";
    await seedMatch(db, matchId);

    const matchRepository = new DrizzleMatchRepository(db);
    const predictionRepository = new DrizzlePredictionRepository(db);

    const command = { matchId, homeScore: 2, awayScore: 2, status: "finished" as const, source: "auto" as const };

    // First call
    await applyMatchResult(command, { matchRepository, predictionRepository }, new SystemClock());

    const rowAfterFirst = await fetchMatchRow(db, matchId);
    expect(rowAfterFirst!["homeScore"]).toBe(2);
    const settledAtFirst = rowAfterFirst!["settledAt"] as string;
    expect(settledAtFirst).not.toBeNull();

    // Second call with identical payload — applyMatchResult idempotency guard fires
    await applyMatchResult(command, { matchRepository, predictionRepository }, new SystemClock());

    const rowAfterSecond = await fetchMatchRow(db, matchId);
    // DB row unchanged — same scores, same settledAt
    expect(rowAfterSecond!["homeScore"]).toBe(2);
    expect(rowAfterSecond!["settledAt"]).toBe(settledAtFirst);
  });
});

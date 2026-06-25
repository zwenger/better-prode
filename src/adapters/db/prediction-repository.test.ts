import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "./test-helpers";
import { LibSqlPredictionRepository } from "./prediction-repository";

/**
 * TDD: PredictionRepository adapter tests (task 1.13 RED → 1.14 GREEN)
 *
 * Integration tests against a local in-memory libSQL instance.
 * Spec (predictions, leaderboard):
 *  - upsert inserts a new prediction
 *  - upsert on existing (user, match) updates it (UNIQUE constraint)
 *  - listByMatch returns all predictions for a match
 *  - updatePoints sets the points field
 *  - leaderboard SUM query works correctly
 */

let db: Client;
let repo: LibSqlPredictionRepository;

const TOURNAMENT_ID = "t1";
const HOME_TEAM = "home-team";
const AWAY_TEAM = "away-team";
const MATCH_ID = "match-pred-test";
const USER_ID_1 = "user-pred-1";
const USER_ID_2 = "user-pred-2";
const GROUP_ID = "group-1";

async function seedFixtures(client: Client): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO tournament(id, name, created_at) VALUES (?, ?, ?)`,
    args: [TOURNAMENT_ID, "Test Tournament", now],
  });
  await client.execute({
    sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
    args: [HOME_TEAM, TOURNAMENT_ID, "Home FC", "HFC"],
  });
  await client.execute({
    sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
    args: [AWAY_TEAM, TOURNAMENT_ID, "Away FC", "AFC"],
  });
  await client.execute({
    sql: `INSERT INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [MATCH_ID, TOURNAMENT_ID, HOME_TEAM, AWAY_TEAM, "2026-06-15T18:00:00Z", "finished", now],
  });
  await client.execute({
    sql: `INSERT INTO "user"(id, email, name, created_at) VALUES (?, ?, ?, ?)`,
    args: [USER_ID_1, "user1@test.com", "User One", now],
  });
  await client.execute({
    sql: `INSERT INTO "user"(id, email, name, created_at) VALUES (?, ?, ?, ?)`,
    args: [USER_ID_2, "user2@test.com", "User Two", now],
  });
  await client.execute({
    sql: `INSERT INTO "group"(id, name, owner_id, created_at) VALUES (?, ?, ?, ?)`,
    args: [GROUP_ID, "Test Group", USER_ID_1, now],
  });
  await client.execute({
    sql: `INSERT INTO group_membership(group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`,
    args: [GROUP_ID, USER_ID_1, "owner", now],
  });
  await client.execute({
    sql: `INSERT INTO group_membership(group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`,
    args: [GROUP_ID, USER_ID_2, "member", now],
  });
}

describe("LibSqlPredictionRepository", () => {
  beforeEach(async () => {
    db = await createTestDb();
    repo = new LibSqlPredictionRepository(db);
    await seedFixtures(db);
  });

  it("upsert inserts a new prediction", async () => {
    const pred = await repo.upsert({
      userId: USER_ID_1,
      matchId: MATCH_ID,
      homeGoals: 2,
      awayGoals: 1,
    });

    expect(pred.id).toBeDefined();
    expect(pred.userId).toBe(USER_ID_1);
    expect(pred.homeGoals).toBe(2);
    expect(pred.points).toBeNull();
  });

  it("upsert updates an existing prediction for the same (user, match)", async () => {
    await repo.upsert({
      userId: USER_ID_1,
      matchId: MATCH_ID,
      homeGoals: 1,
      awayGoals: 0,
    });

    const updated = await repo.upsert({
      userId: USER_ID_1,
      matchId: MATCH_ID,
      homeGoals: 3,
      awayGoals: 2,
    });

    expect(updated.homeGoals).toBe(3);
    expect(updated.awayGoals).toBe(2);

    // Only one prediction in DB
    const all = await repo.listByMatch(MATCH_ID);
    expect(all).toHaveLength(1);
  });

  it("listByMatch returns all predictions for a match", async () => {
    await repo.upsert({ userId: USER_ID_1, matchId: MATCH_ID, homeGoals: 1, awayGoals: 0 });
    await repo.upsert({ userId: USER_ID_2, matchId: MATCH_ID, homeGoals: 0, awayGoals: 0 });

    const preds = await repo.listByMatch(MATCH_ID);
    expect(preds).toHaveLength(2);
    expect(preds.map((p) => p.userId).sort()).toEqual([USER_ID_1, USER_ID_2].sort());
  });

  it("listByMatch returns empty array for a match with no predictions", async () => {
    const preds = await repo.listByMatch("match-no-preds");
    expect(preds).toHaveLength(0);
  });

  it("updatePoints sets the points field on a prediction", async () => {
    const pred = await repo.upsert({
      userId: USER_ID_1,
      matchId: MATCH_ID,
      homeGoals: 2,
      awayGoals: 1,
    });

    await repo.updatePoints(pred.id, 7);

    const [updated] = await repo.listByMatch(MATCH_ID);
    expect(updated.points).toBe(7);
  });

  // C1 RED: leaderboard must only sum points from the requested tournament,
  // not accumulate predictions from all tournaments.
  it("leaderboard SUM: only counts points from the requested tournament (cross-tournament isolation)", async () => {
    const TOURNAMENT_ID_2 = "t2";
    const MATCH_ID_2 = "match-t2-test";
    const now = new Date().toISOString();

    // Seed a second tournament with its own match
    await db.execute({
      sql: `INSERT INTO tournament(id, name, created_at) VALUES (?, ?, ?)`,
      args: [TOURNAMENT_ID_2, "Other Tournament", now],
    });
    // Reuse the same teams (they belong to t1 per seedFixtures — add t2 own teams)
    const HOME_TEAM_2 = "home-team-t2";
    const AWAY_TEAM_2 = "away-team-t2";
    await db.execute({
      sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
      args: [HOME_TEAM_2, TOURNAMENT_ID_2, "Home T2", "HT2"],
    });
    await db.execute({
      sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
      args: [AWAY_TEAM_2, TOURNAMENT_ID_2, "Away T2", "AT2"],
    });
    await db.execute({
      sql: `INSERT INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [MATCH_ID_2, TOURNAMENT_ID_2, HOME_TEAM_2, AWAY_TEAM_2, "2026-07-01T18:00:00Z", "finished", now],
    });

    // USER_ID_1 predicts in both tournaments
    const predT1 = await repo.upsert({ userId: USER_ID_1, matchId: MATCH_ID, homeGoals: 2, awayGoals: 1 });
    const predT2 = await repo.upsert({ userId: USER_ID_1, matchId: MATCH_ID_2, homeGoals: 1, awayGoals: 0 });

    await repo.updatePoints(predT1.id, 7);  // 7 pts in tournament 1
    await repo.updatePoints(predT2.id, 10); // 10 pts in tournament 2

    // Leaderboard for TOURNAMENT_ID (t1) must return only 7, not 17
    const leaderboard = await repo.getLeaderboard(GROUP_ID, TOURNAMENT_ID);

    const u1Entry = leaderboard.find((e) => e.userId === USER_ID_1);
    // CRITICAL: must NOT include t2 points (10), only t1 points (7)
    expect(u1Entry!.totalPoints).toBe(7);
  });

  // W3 RED: concurrent upsert for the same (user, match) must update, not 500.
  // SELECT-then-INSERT races under concurrency — use atomic INSERT ... ON CONFLICT.
  it("upsert is atomic: concurrent upserts for the same (user, match) update without error", async () => {
    // Fire 5 concurrent upserts for the same (user, match) pair.
    // The non-atomic SELECT+INSERT implementation would either throw a UNIQUE
    // constraint error on the second concurrent insert or produce duplicate rows.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        repo.upsert({
          userId: USER_ID_1,
          matchId: MATCH_ID,
          homeGoals: i,
          awayGoals: 0,
        })
      )
    );

    // All calls must resolve without error
    expect(results).toHaveLength(5);

    // Only one row must exist in the DB (no duplicates)
    const all = await repo.listByMatch(MATCH_ID);
    expect(all).toHaveLength(1);
  });

  it("leaderboard SUM: sum of points per user in a group for a tournament", async () => {
    const pred1 = await repo.upsert({
      userId: USER_ID_1,
      matchId: MATCH_ID,
      homeGoals: 2,
      awayGoals: 1,
    });
    const pred2 = await repo.upsert({
      userId: USER_ID_2,
      matchId: MATCH_ID,
      homeGoals: 0,
      awayGoals: 1,
    });

    await repo.updatePoints(pred1.id, 7);
    await repo.updatePoints(pred2.id, 3);

    const leaderboard = await repo.getLeaderboard(GROUP_ID, TOURNAMENT_ID);
    expect(leaderboard).toHaveLength(2);

    const u1Entry = leaderboard.find((e) => e.userId === USER_ID_1);
    const u2Entry = leaderboard.find((e) => e.userId === USER_ID_2);

    expect(u1Entry!.totalPoints).toBe(7);
    expect(u2Entry!.totalPoints).toBe(3);
  });
});

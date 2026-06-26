import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "./test-helpers";
import { DrizzlePredictionRepository } from "./prediction-repository";
import type { DrizzleDb } from "#/infra/db/client";

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

let db: DrizzleDb & { $client: Client };
let repo: DrizzlePredictionRepository;

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
    sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`,
    args: [USER_ID_1, "User One", "user1@test.com", now, now],
  });
  await client.execute({
    sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`,
    args: [USER_ID_2, "User Two", "user2@test.com", now, now],
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

describe("DrizzlePredictionRepository", () => {
  beforeEach(async () => {
    db = await createTestDb();
    repo = new DrizzlePredictionRepository(db);
    await seedFixtures(db.$client);
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
    await db.$client.execute({
      sql: `INSERT INTO tournament(id, name, created_at) VALUES (?, ?, ?)`,
      args: [TOURNAMENT_ID_2, "Other Tournament", now],
    });
    // Reuse the same teams (they belong to t1 per seedFixtures — add t2 own teams)
    const HOME_TEAM_2 = "home-team-t2";
    const AWAY_TEAM_2 = "away-team-t2";
    await db.$client.execute({
      sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
      args: [HOME_TEAM_2, TOURNAMENT_ID_2, "Home T2", "HT2"],
    });
    await db.$client.execute({
      sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
      args: [AWAY_TEAM_2, TOURNAMENT_ID_2, "Away T2", "AT2"],
    });
    await db.$client.execute({
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

  // W-3: Verify the LEFT JOIN guarantee — a group member with zero predictions
  // must still appear in the leaderboard with totalPoints === 0.
  it("leaderboard SUM: member with no predictions appears with totalPoints 0 (LEFT JOIN guarantee)", async () => {
    // USER_ID_1 has a prediction with points; USER_ID_2 has no predictions at all.
    const pred1 = await repo.upsert({
      userId: USER_ID_1,
      matchId: MATCH_ID,
      homeGoals: 1,
      awayGoals: 0,
    });
    await repo.updatePoints(pred1.id, 7);

    // USER_ID_2 is a group member (seeded in seedFixtures) but has no prediction.
    const leaderboard = await repo.getLeaderboard(GROUP_ID, TOURNAMENT_ID);

    // Both members must appear
    expect(leaderboard.length).toBeGreaterThanOrEqual(2);

    const u1Entry = leaderboard.find((e) => e.userId === USER_ID_1);
    const u2Entry = leaderboard.find((e) => e.userId === USER_ID_2);

    // u1 has points; u2 has zero (LEFT JOIN → COALESCE(SUM(null),0) = 0)
    expect(u1Entry!.totalPoints).toBe(7);
    expect(u2Entry!.totalPoints).toBe(0);
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

// ---------------------------------------------------------------------------
// W-4: getMatchLeaderboard — per-match points breakdown for group members.
//   Spec: "users see each group member's points for a specific match."
//   RED first → then implementation.
// ---------------------------------------------------------------------------

describe("DrizzlePredictionRepository.getMatchLeaderboard (W-4)", () => {
  const MATCH_ID_LB = MATCH_ID; // reuse the match seeded in seedFixtures

  beforeEach(async () => {
    db = await createTestDb();
    repo = new DrizzlePredictionRepository(db);
    await seedFixtures(db.$client);
  });

  it("returns each group member's prediction and points for a specific match", async () => {
    // user 1 has a prediction with points; user 2 also has one
    const p1 = await repo.upsert({ userId: USER_ID_1, matchId: MATCH_ID_LB, homeGoals: 2, awayGoals: 1 });
    const p2 = await repo.upsert({ userId: USER_ID_2, matchId: MATCH_ID_LB, homeGoals: 0, awayGoals: 0 });
    await repo.updatePoints(p1.id, 7);
    await repo.updatePoints(p2.id, 1);

    const breakdown = await repo.getMatchLeaderboard(GROUP_ID, MATCH_ID_LB);

    expect(breakdown).toHaveLength(2);
    const e1 = breakdown.find((e) => e.userId === USER_ID_1);
    const e2 = breakdown.find((e) => e.userId === USER_ID_2);
    expect(e1).toMatchObject({ homeGoals: 2, awayGoals: 1, points: 7 });
    expect(e2).toMatchObject({ homeGoals: 0, awayGoals: 0, points: 1 });
  });

  it("returns null homeGoals/awayGoals/points for a member who has no prediction for the match", async () => {
    // user 1 predicts; user 2 does not
    const p1 = await repo.upsert({ userId: USER_ID_1, matchId: MATCH_ID_LB, homeGoals: 1, awayGoals: 0 });
    await repo.updatePoints(p1.id, 4);

    const breakdown = await repo.getMatchLeaderboard(GROUP_ID, MATCH_ID_LB);

    expect(breakdown).toHaveLength(2);
    const e1 = breakdown.find((e) => e.userId === USER_ID_1);
    const e2 = breakdown.find((e) => e.userId === USER_ID_2);
    expect(e1).toMatchObject({ homeGoals: 1, awayGoals: 0, points: 4 });
    // user 2 has no prediction → nulls
    expect(e2!.homeGoals).toBeNull();
    expect(e2!.awayGoals).toBeNull();
    expect(e2!.points).toBeNull();
  });

  it("returns all group members even when nobody has predicted the match", async () => {
    const breakdown = await repo.getMatchLeaderboard(GROUP_ID, MATCH_ID_LB);
    // Both members appear (LEFT JOIN)
    expect(breakdown).toHaveLength(2);
    for (const e of breakdown) {
      expect(e.homeGoals).toBeNull();
      expect(e.awayGoals).toBeNull();
      expect(e.points).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Task 4.6: findByUserForMatches — batch lookup of user's predictions
//   RED tests written first (TDD); implementation in prediction-repository.ts
// ---------------------------------------------------------------------------

describe("DrizzlePredictionRepository.findByUserForMatches", () => {
  let db2: DrizzleDb & { $client: Client };
  let repo2: DrizzlePredictionRepository;
  const TID = "t-find";
  const HOME = "home-find";
  const AWAY = "away-find";
  const M1 = "match-find-1";
  const M2 = "match-find-2";
  const M3 = "match-find-3";
  const U1 = "user-find-1";
  const U2 = "user-find-2";

  beforeEach(async () => {
    db2 = await createTestDb();
    repo2 = new DrizzlePredictionRepository(db2);
    const now = new Date().toISOString();
    const c = db2.$client;

    await c.execute({ sql: `INSERT INTO tournament(id, name, created_at) VALUES (?, ?, ?)`, args: [TID, "Find T", now] });
    await c.execute({ sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`, args: [HOME, TID, "Home Find", "HF"] });
    await c.execute({ sql: `INSERT INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`, args: [AWAY, TID, "Away Find", "AF"] });
    for (const mid of [M1, M2, M3]) {
      await c.execute({ sql: `INSERT INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: [mid, TID, HOME, AWAY, "2026-07-01T18:00:00Z", "scheduled", now] });
    }
    await c.execute({ sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`, args: [U1, "Find User 1", "find1@test.com", now, now] });
    await c.execute({ sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`, args: [U2, "Find User 2", "find2@test.com", now, now] });
  });

  it("returns an empty map when the user has no predictions for any of the given matches", async () => {
    const result = await repo2.findByUserForMatches(U1, [M1, M2]);
    expect(result.size).toBe(0);
  });

  it("returns predictions keyed by matchId for the given user", async () => {
    await repo2.upsert({ userId: U1, matchId: M1, homeGoals: 2, awayGoals: 1 });
    await repo2.upsert({ userId: U1, matchId: M2, homeGoals: 0, awayGoals: 0 });

    const result = await repo2.findByUserForMatches(U1, [M1, M2, M3]);

    expect(result.size).toBe(2);
    expect(result.get(M1)).toMatchObject({ homeGoals: 2, awayGoals: 1 });
    expect(result.get(M2)).toMatchObject({ homeGoals: 0, awayGoals: 0 });
    expect(result.get(M3)).toBeUndefined();
  });

  it("does NOT return predictions from another user", async () => {
    await repo2.upsert({ userId: U2, matchId: M1, homeGoals: 3, awayGoals: 1 });

    const result = await repo2.findByUserForMatches(U1, [M1]);
    expect(result.size).toBe(0);
  });

  it("handles empty matchIds array by returning an empty map without error", async () => {
    await repo2.upsert({ userId: U1, matchId: M1, homeGoals: 1, awayGoals: 0 });

    const result = await repo2.findByUserForMatches(U1, []);
    expect(result.size).toBe(0);
  });

  it("only returns predictions for the subset of matchIds passed in", async () => {
    await repo2.upsert({ userId: U1, matchId: M1, homeGoals: 1, awayGoals: 0 });
    await repo2.upsert({ userId: U1, matchId: M2, homeGoals: 2, awayGoals: 2 });
    await repo2.upsert({ userId: U1, matchId: M3, homeGoals: 3, awayGoals: 1 });

    // Only ask for M1 + M3
    const result = await repo2.findByUserForMatches(U1, [M1, M3]);

    expect(result.size).toBe(2);
    expect(result.has(M2)).toBe(false);
    expect(result.get(M1)).toMatchObject({ homeGoals: 1, awayGoals: 0 });
    expect(result.get(M3)).toMatchObject({ homeGoals: 3, awayGoals: 1 });
  });
});

// ---------------------------------------------------------------------------
// getLeaderboardWithNames — leaderboard with display names and plenos count
// ---------------------------------------------------------------------------

describe("DrizzlePredictionRepository.getLeaderboardWithNames", () => {
  beforeEach(async () => {
    db = await createTestDb();
    repo = new DrizzlePredictionRepository(db);
    await seedFixtures(db.$client);
  });

  it("returns displayName, totalPoints=7, plenosCount=1 for a pleno prediction", async () => {
    const pred = await repo.upsert({ userId: USER_ID_1, matchId: MATCH_ID, homeGoals: 2, awayGoals: 1 });
    await repo.updatePoints(pred.id, 7);

    const entries = await repo.getLeaderboardWithNames(GROUP_ID, TOURNAMENT_ID);

    const e1 = entries.find((e) => e.userId === USER_ID_1);
    expect(e1).toBeDefined();
    expect(e1!.displayName).toBe("User One");
    expect(e1!.totalPoints).toBe(7);
    expect(e1!.plenosCount).toBe(1);
  });

  it("returns totalPoints=0, plenosCount=0 for a member with no predictions", async () => {
    // USER_ID_2 has no predictions at all
    const entries = await repo.getLeaderboardWithNames(GROUP_ID, TOURNAMENT_ID);

    const e2 = entries.find((e) => e.userId === USER_ID_2);
    expect(e2).toBeDefined();
    expect(e2!.displayName).toBe("User Two");
    expect(e2!.totalPoints).toBe(0);
    expect(e2!.plenosCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getMemberPredictions — member prediction entries with match metadata
// ---------------------------------------------------------------------------

describe("DrizzlePredictionRepository.getMemberPredictions", () => {
  beforeEach(async () => {
    db = await createTestDb();
    repo = new DrizzlePredictionRepository(db);
    await seedFixtures(db.$client);
    // MATCH_ID is already "finished" (seeded in seedFixtures)
  });

  it("returns prediction with correct fields for a finished match", async () => {
    const pred = await repo.upsert({ userId: USER_ID_1, matchId: MATCH_ID, homeGoals: 2, awayGoals: 1 });
    await repo.updatePoints(pred.id, 4);

    const entries = await repo.getMemberPredictions(USER_ID_1, GROUP_ID, TOURNAMENT_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0].predHomeGoals).toBe(2);
    expect(entries[0].predAwayGoals).toBe(1);
    expect(entries[0].points).toBe(4);
    expect(entries[0].homeName).toBe("Home FC");
    expect(entries[0].homeCode).toBe("HFC");
    expect(entries[0].awayName).toBe("Away FC");
    expect(entries[0].status).toBe("finished");
  });

  it("returns empty array when member is not in the group (EXISTS guard)", async () => {
    // USER_ID_3 is not a group member
    const USER_ID_3 = "user-not-member";
    const now = new Date().toISOString();
    await db.$client.execute({
      sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`,
      args: [USER_ID_3, "Not Member", "notmember@test.com", now, now],
    });
    await repo.upsert({ userId: USER_ID_3, matchId: MATCH_ID, homeGoals: 2, awayGoals: 1 });

    // USER_ID_3 is not in GROUP_ID → should return empty
    const entries = await repo.getMemberPredictions(USER_ID_3, GROUP_ID, TOURNAMENT_ID);
    expect(entries).toHaveLength(0);
  });

  it("does NOT return predictions for scheduled matches", async () => {
    // Insert a scheduled match and predict it
    const now = new Date().toISOString();
    await db.$client.execute({
      sql: `INSERT INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["match-scheduled-test", TOURNAMENT_ID, HOME_TEAM, AWAY_TEAM, "2026-12-01T18:00:00Z", "scheduled", now],
    });
    await repo.upsert({ userId: USER_ID_1, matchId: "match-scheduled-test", homeGoals: 1, awayGoals: 0 });

    const entries = await repo.getMemberPredictions(USER_ID_1, GROUP_ID, TOURNAMENT_ID);

    // The scheduled match prediction should NOT appear
    expect(entries.every((e) => e.status !== "scheduled")).toBe(true);
  });
});

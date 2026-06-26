import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "./test-helpers";
import { DrizzleMatchRepository } from "./match-repository";
import type { DrizzleDb } from "#/infra/db/client";

/**
 * TDD: MatchRepository adapter tests (task 1.11 RED → 1.12 GREEN)
 *
 * Integration tests against a local in-memory libSQL instance.
 * Proves the adapter correctly implements the MatchRepository port.
 *
 * Spec (match-results):
 *  - getById returns the match or null
 *  - updateResult persists result fields + settledAt
 *  - round-trip through insert + getById
 */

let db: DrizzleDb & { $client: Client };
let repo: DrizzleMatchRepository;

const TOURNAMENT_ID = "tournament-1";
const HOME_TEAM = "team-home";
const AWAY_TEAM = "team-away";
const MATCH_ID = "match-adapter-test";

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
    args: [
      MATCH_ID,
      TOURNAMENT_ID,
      HOME_TEAM,
      AWAY_TEAM,
      "2026-06-15T18:00:00.000Z",
      "finished",
      now,
    ],
  });
}

describe("DrizzleMatchRepository", () => {
  beforeEach(async () => {
    db = await createTestDb();
    repo = new DrizzleMatchRepository(db);
    await seedFixtures(db.$client);
  });

  it("getById returns the match when it exists", async () => {
    const match = await repo.getById(MATCH_ID);

    expect(match).not.toBeNull();
    expect(match!.id).toBe(MATCH_ID);
    expect(match!.tournamentId).toBe(TOURNAMENT_ID);
    expect(match!.status).toBe("finished");
    expect(match!.homeScore).toBeNull();
    expect(match!.settledAt).toBeNull();
  });

  it("getById returns null for a missing match", async () => {
    const match = await repo.getById("nonexistent-match");
    expect(match).toBeNull();
  });

  it("updateResult persists homeScore, awayScore, resultSource, settledAt", async () => {
    const now = new Date().toISOString();
    await repo.updateResult(MATCH_ID, {
      homeScore: 2,
      awayScore: 1,
      resultSource: "auto",
      settledAt: now,
      status: "finished",
    });

    const match = await repo.getById(MATCH_ID);
    expect(match!.homeScore).toBe(2);
    expect(match!.awayScore).toBe(1);
    expect(match!.resultSource).toBe("auto");
    expect(match!.settledAt).toBe(now);
  });

  it("updateResult with manual source persists manual", async () => {
    const now = new Date().toISOString();
    await repo.updateResult(MATCH_ID, {
      homeScore: 0,
      awayScore: 0,
      resultSource: "manual",
      settledAt: now,
      status: "finished",
    });

    const match = await repo.getById(MATCH_ID);
    expect(match!.resultSource).toBe("manual");
    expect(match!.homeScore).toBe(0);
  });

  it("updateResult can be called twice (idempotent round-trip)", async () => {
    const now = new Date().toISOString();
    await repo.updateResult(MATCH_ID, {
      homeScore: 1,
      awayScore: 1,
      resultSource: "auto",
      settledAt: now,
    });

    // Second update (recompute path)
    const later = new Date(Date.now() + 1000).toISOString();
    await repo.updateResult(MATCH_ID, {
      homeScore: 2,
      awayScore: 2,
      resultSource: "manual",
      settledAt: later,
    });

    const match = await repo.getById(MATCH_ID);
    expect(match!.homeScore).toBe(2);
    expect(match!.resultSource).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// getTeamMatches
// ---------------------------------------------------------------------------

describe("DrizzleMatchRepository.getTeamMatches", () => {
  const TEAM_ARG = "team-arg";
  const TEAM_BRA = "team-bra";
  const TEAM_OTHER = "team-other";
  const MATCH_TM_1 = "match-tm-1";
  const MATCH_TM_2 = "match-tm-2";
  const MATCH_TM_3 = "match-tm-3";

  beforeEach(async () => {
    const now = new Date().toISOString();

    // Seed two additional teams (ARG and BRA) and a third unrelated team
    await db.$client.execute({
      sql: `INSERT OR IGNORE INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
      args: [TEAM_ARG, TOURNAMENT_ID, "Argentina", "ar"],
    });
    await db.$client.execute({
      sql: `INSERT OR IGNORE INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
      args: [TEAM_BRA, TOURNAMENT_ID, "Brazil", "br"],
    });
    await db.$client.execute({
      sql: `INSERT OR IGNORE INTO team(id, tournament_id, name, code) VALUES (?, ?, ?, ?)`,
      args: [TEAM_OTHER, TOURNAMENT_ID, "Other FC", "ot"],
    });

    // match-tm-1: ARG (home) vs BRA (away) — earlier kickoff
    await db.$client.execute({
      sql: `INSERT OR IGNORE INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        MATCH_TM_1,
        TOURNAMENT_ID,
        TEAM_ARG,
        TEAM_BRA,
        "2026-07-01T14:00:00.000Z",
        "finished",
        now,
      ],
    });

    // match-tm-2: BRA (home) vs ARG (away) — later kickoff
    await db.$client.execute({
      sql: `INSERT OR IGNORE INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        MATCH_TM_2,
        TOURNAMENT_ID,
        TEAM_BRA,
        TEAM_ARG,
        "2026-07-10T18:00:00.000Z",
        "scheduled",
        now,
      ],
    });

    // match-tm-3: HOME_TEAM vs OTHER (no ARG/BRA) — unrelated
    await db.$client.execute({
      sql: `INSERT OR IGNORE INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        MATCH_TM_3,
        TOURNAMENT_ID,
        HOME_TEAM,
        TEAM_OTHER,
        "2026-07-05T20:00:00.000Z",
        "scheduled",
        now,
      ],
    });
  });

  it("returns matches where the team is home", async () => {
    // ARG is home in match-tm-1
    const results = await repo.getTeamMatches("ar");
    const ids = results.map((r) => r.id);
    expect(ids).toContain(MATCH_TM_1);
  });

  it("returns matches where the team is away", async () => {
    // ARG is away in match-tm-2
    const results = await repo.getTeamMatches("ar");
    const ids = results.map((r) => r.id);
    expect(ids).toContain(MATCH_TM_2);
  });

  it("returns empty array when team has no matches", async () => {
    const results = await repo.getTeamMatches("zz");
    expect(results).toHaveLength(0);
  });

  it("returns both home and away matches for a team", async () => {
    const results = await repo.getTeamMatches("ar");
    const ids = results.map((r) => r.id);
    expect(ids).toContain(MATCH_TM_1);
    expect(ids).toContain(MATCH_TM_2);
    // Should NOT include the unrelated match
    expect(ids).not.toContain(MATCH_TM_3);
  });

  it("orders matches by kickoff ascending", async () => {
    const results = await repo.getTeamMatches("ar");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // match-tm-1 has an earlier kickoff than match-tm-2
    const idx1 = results.findIndex((r) => r.id === MATCH_TM_1);
    const idx2 = results.findIndex((r) => r.id === MATCH_TM_2);
    expect(idx1).toBeLessThan(idx2);
  });
});

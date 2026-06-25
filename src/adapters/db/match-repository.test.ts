import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "./test-helpers";
import { LibSqlMatchRepository } from "./match-repository";

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

let db: Client;
let repo: LibSqlMatchRepository;

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

describe("LibSqlMatchRepository", () => {
  beforeEach(async () => {
    db = await createTestDb();
    repo = new LibSqlMatchRepository(db);
    await seedFixtures(db);
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

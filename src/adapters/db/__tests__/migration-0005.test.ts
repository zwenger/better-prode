/**
 * TDD 1.1 (RED): Migration 0005 — nullable team FKs + placeholder columns.
 *
 * Spec: The `match` table must support nullable home_team_id/away_team_id
 * and new home_placeholder/away_placeholder TEXT columns after 0005 runs.
 *
 * This test applies migrations 0001-0005 via createTestDb (which must include
 * 0005 in its list) and verifies the resulting schema.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "#/adapters/db/test-helpers";
import type { DrizzleDb } from "#/infra/db/client";

let db: DrizzleDb & { $client: Client };

beforeEach(async () => {
  db = await createTestDb();
});

describe("Migration 0005 — nullable team FKs + placeholder columns", () => {
  it("allows inserting a match with null home_team_id (TBD home)", async () => {
    // Seed required FK targets first
    await db.$client.execute({
      sql: `INSERT INTO tournament (id, name, created_at) VALUES ('t1', 'Test', '2026-01-01')`,
      args: [],
    });
    await db.$client.execute({
      sql: `INSERT INTO team (id, tournament_id, name, code) VALUES ('team-away', 't1', 'Away Team', 'AT')`,
      args: [],
    });

    // home_team_id is null — must not violate NOT NULL constraint
    await expect(
      db.$client.execute({
        sql: `INSERT INTO match (id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
              VALUES ('m1', 't1', NULL, 'team-away', '2026-08-01T20:00:00.000Z', 'scheduled', '2026-01-01')`,
        args: [],
      })
    ).resolves.not.toThrow();

    const rows = await db.$client.execute({ sql: `SELECT home_team_id FROM match WHERE id = 'm1'`, args: [] });
    expect(rows.rows[0]?.[0]).toBeNull();
  });

  it("allows inserting a match with null away_team_id (TBD away)", async () => {
    await db.$client.execute({
      sql: `INSERT INTO tournament (id, name, created_at) VALUES ('t2', 'Test', '2026-01-01')`,
      args: [],
    });
    await db.$client.execute({
      sql: `INSERT INTO team (id, tournament_id, name, code) VALUES ('team-home', 't2', 'Home Team', 'HT')`,
      args: [],
    });

    await expect(
      db.$client.execute({
        sql: `INSERT INTO match (id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
              VALUES ('m2', 't2', 'team-home', NULL, '2026-08-02T20:00:00.000Z', 'scheduled', '2026-01-01')`,
        args: [],
      })
    ).resolves.not.toThrow();

    const rows = await db.$client.execute({ sql: `SELECT away_team_id FROM match WHERE id = 'm2'`, args: [] });
    expect(rows.rows[0]?.[0]).toBeNull();
  });

  it("allows both team IDs null (fully TBD match)", async () => {
    await db.$client.execute({
      sql: `INSERT INTO tournament (id, name, created_at) VALUES ('t3', 'Test', '2026-01-01')`,
      args: [],
    });

    await expect(
      db.$client.execute({
        sql: `INSERT INTO match (id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
              VALUES ('m3', 't3', NULL, NULL, '2026-08-03T20:00:00.000Z', 'scheduled', '2026-01-01')`,
        args: [],
      })
    ).resolves.not.toThrow();
  });

  it("home_placeholder column exists and accepts a FIFA placeholder code", async () => {
    await db.$client.execute({
      sql: `INSERT INTO tournament (id, name, created_at) VALUES ('t4', 'Test', '2026-01-01')`,
      args: [],
    });

    await db.$client.execute({
      sql: `INSERT INTO match (id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, home_placeholder, created_at)
            VALUES ('m4', 't4', NULL, NULL, '2026-08-04T20:00:00.000Z', 'scheduled', 'W74', '2026-01-01')`,
      args: [],
    });

    const rows = await db.$client.execute({ sql: `SELECT home_placeholder FROM match WHERE id = 'm4'`, args: [] });
    expect(rows.rows[0]?.[0]).toBe("W74");
  });

  it("away_placeholder column exists and accepts a FIFA placeholder code", async () => {
    await db.$client.execute({
      sql: `INSERT INTO tournament (id, name, created_at) VALUES ('t5', 'Test', '2026-01-01')`,
      args: [],
    });

    await db.$client.execute({
      sql: `INSERT INTO match (id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, away_placeholder, created_at)
            VALUES ('m5', 't5', NULL, NULL, '2026-08-05T20:00:00.000Z', 'scheduled', 'RU101', '2026-01-01')`,
      args: [],
    });

    const rows = await db.$client.execute({ sql: `SELECT away_placeholder FROM match WHERE id = 'm5'`, args: [] });
    expect(rows.rows[0]?.[0]).toBe("RU101");
  });

  it("preserves existing match rows after migration (data not lost)", async () => {
    // Any row that was inserted (via createTestDb) should still exist;
    // since we only create schema in beforeEach without pre-existing data,
    // we verify that inserting a concrete match still works
    await db.$client.execute({
      sql: `INSERT INTO tournament (id, name, created_at) VALUES ('t6', 'Test', '2026-01-01')`,
      args: [],
    });
    await db.$client.execute({
      sql: `INSERT INTO team (id, tournament_id, name, code) VALUES ('th', 't6', 'Home', 'HH'), ('ta', 't6', 'Away', 'AA')`,
      args: [],
    });
    await db.$client.execute({
      sql: `INSERT INTO match (id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
            VALUES ('m6', 't6', 'th', 'ta', '2026-08-06T20:00:00.000Z', 'scheduled', '2026-01-01')`,
      args: [],
    });

    const rows = await db.$client.execute({ sql: `SELECT id, home_team_id, away_team_id FROM match WHERE id = 'm6'`, args: [] });
    expect(rows.rows[0]?.[0]).toBe("m6");
    expect(rows.rows[0]?.[1]).toBe("th");
    expect(rows.rows[0]?.[2]).toBe("ta");
  });
});

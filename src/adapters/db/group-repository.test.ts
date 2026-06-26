/**
 * TDD: GroupRepository adapter tests — task 2.8 RED → 2.9 GREEN
 *
 * Integration tests against in-memory libSQL.
 * Proves the adapter correctly implements the GroupRepository port.
 *
 * Spec (groups): create group, add/get/list/remove memberships, update role,
 * list groups by user.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "./test-helpers";
import { DrizzleGroupRepository } from "./group-repository";
import type { DrizzleDb } from "#/infra/db/client";

let db: DrizzleDb & { $client: Client };
let repo: DrizzleGroupRepository;

const OWNER_ID = "user-group-owner";
const MEMBER_ID = "user-group-member";
const ADMIN_ID = "user-group-admin";

async function seedUsers(client: Client): Promise<void> {
  const now = new Date().toISOString();
  for (const [id, email, name] of [
    [OWNER_ID, "owner@test.com", "Owner"],
    [MEMBER_ID, "member@test.com", "Member"],
    [ADMIN_ID, "admin@test.com", "Admin"],
  ] as [string, string, string][]) {
    await client.execute({
      sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`,
      args: [id, name, email, now, now],
    });
  }
}

describe("DrizzleGroupRepository", () => {
  beforeEach(async () => {
    db = await createTestDb();
    repo = new DrizzleGroupRepository(db);
    await seedUsers(db.$client);
  });

  it("create persists a group and getById returns it", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "g-1", name: "Test Group", ownerId: OWNER_ID, createdAt: now });

    const found = await repo.getById("g-1");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test Group");
    expect(found!.ownerId).toBe(OWNER_ID);
  });

  it("getById returns null for a missing group", async () => {
    const found = await repo.getById("no-such-group");
    expect(found).toBeNull();
  });

  it("addMembership and getMembership round-trip", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "g-1", name: "Test Group", ownerId: OWNER_ID, createdAt: now });
    await repo.addMembership({ groupId: "g-1", userId: OWNER_ID, role: "owner", joinedAt: now });

    const m = await repo.getMembership("g-1", OWNER_ID);
    expect(m).not.toBeNull();
    expect(m!.role).toBe("owner");
  });

  it("getMembership returns null when user is not in group", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "g-1", name: "Test Group", ownerId: OWNER_ID, createdAt: now });

    const m = await repo.getMembership("g-1", MEMBER_ID);
    expect(m).toBeNull();
  });

  it("listMemberships returns all members of a group", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "g-1", name: "Test Group", ownerId: OWNER_ID, createdAt: now });
    await repo.addMembership({ groupId: "g-1", userId: OWNER_ID, role: "owner", joinedAt: now });
    await repo.addMembership({ groupId: "g-1", userId: MEMBER_ID, role: "member", joinedAt: now });

    const memberships = await repo.listMemberships("g-1");
    expect(memberships).toHaveLength(2);
    expect(memberships.map((m) => m.userId).sort()).toEqual([OWNER_ID, MEMBER_ID].sort());
  });

  it("updateMembershipRole changes the role", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "g-1", name: "Test Group", ownerId: OWNER_ID, createdAt: now });
    await repo.addMembership({ groupId: "g-1", userId: MEMBER_ID, role: "member", joinedAt: now });

    await repo.updateMembershipRole("g-1", MEMBER_ID, "admin");

    const m = await repo.getMembership("g-1", MEMBER_ID);
    expect(m!.role).toBe("admin");
  });

  it("removeMembership deletes the membership", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "g-1", name: "Test Group", ownerId: OWNER_ID, createdAt: now });
    await repo.addMembership({ groupId: "g-1", userId: MEMBER_ID, role: "member", joinedAt: now });

    await repo.removeMembership("g-1", MEMBER_ID);

    const m = await repo.getMembership("g-1", MEMBER_ID);
    expect(m).toBeNull();
  });

  it("listByUser returns all groups the user belongs to with their role", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "g-1", name: "Group A", ownerId: OWNER_ID, createdAt: now });
    await repo.create({ id: "g-2", name: "Group B", ownerId: OWNER_ID, createdAt: now });
    await repo.addMembership({ groupId: "g-1", userId: OWNER_ID, role: "owner", joinedAt: now });
    await repo.addMembership({ groupId: "g-2", userId: OWNER_ID, role: "owner", joinedAt: now });
    await repo.addMembership({ groupId: "g-1", userId: MEMBER_ID, role: "member", joinedAt: now });

    const ownerGroups = await repo.listByUser(OWNER_ID);
    expect(ownerGroups).toHaveLength(2);

    const memberGroups = await repo.listByUser(MEMBER_ID);
    expect(memberGroups).toHaveLength(1);
    expect(memberGroups[0].name).toBe("Group A");
    expect(memberGroups[0].role).toBe("member");
  });

  it("listByUser returns empty array when user has no groups", async () => {
    const groups = await repo.listByUser(ADMIN_ID);
    expect(groups).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // listGroupIdsByTournament (W-1 fix)
  //
  // Returns distinct group IDs that have at least one member with a prediction
  // in the given tournament. Used by applyMatchResult to enumerate which group
  // leaderboard caches to invalidate after a settlement.
  //
  // Relies on the join: group_membership → prediction → match.tournament_id
  // ---------------------------------------------------------------------------

  it("listGroupIdsByTournament returns groups that have predictions in the tournament", async () => {
    const now = new Date().toISOString();
    const client = db.$client;

    // Seed tournament + team + match
    await client.execute({ sql: `INSERT INTO tournament(id, name, created_at) VALUES ('t1', 'T1', ?)`, args: [now] });
    await client.execute({ sql: `INSERT INTO team(id, tournament_id, name, code) VALUES ('team-a', 't1', 'TeamA', 'TA')`, args: [] });
    await client.execute({ sql: `INSERT INTO team(id, tournament_id, name, code) VALUES ('team-b', 't1', 'TeamB', 'TB')`, args: [] });
    await client.execute({
      sql: `INSERT INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at) VALUES ('m1', 't1', 'team-a', 'team-b', ?, 'finished', ?)`,
      args: [now, now],
    });

    // Two groups, each with one member who has a prediction in t1
    await repo.create({ id: "g-1", name: "Group A", ownerId: OWNER_ID, createdAt: now });
    await repo.create({ id: "g-2", name: "Group B", ownerId: MEMBER_ID, createdAt: now });
    await repo.addMembership({ groupId: "g-1", userId: OWNER_ID, role: "owner", joinedAt: now });
    await repo.addMembership({ groupId: "g-2", userId: MEMBER_ID, role: "owner", joinedAt: now });

    // prediction for OWNER_ID in t1 (via match m1)
    await client.execute({
      sql: `INSERT INTO prediction(id, user_id, match_id, home_goals, away_goals, points, created_at, updated_at) VALUES ('pred-1', ?, 'm1', 1, 0, NULL, ?, ?)`,
      args: [OWNER_ID, now, now],
    });
    // prediction for MEMBER_ID in t1
    await client.execute({
      sql: `INSERT INTO prediction(id, user_id, match_id, home_goals, away_goals, points, created_at, updated_at) VALUES ('pred-2', ?, 'm1', 2, 1, NULL, ?, ?)`,
      args: [MEMBER_ID, now, now],
    });

    const groupIds = await repo.listGroupIdsByTournament("t1");
    expect(groupIds.sort()).toEqual(["g-1", "g-2"].sort());
  });

  it("listGroupIdsByTournament excludes groups whose members have no predictions in the tournament", async () => {
    const now = new Date().toISOString();

    // A group with a member but NO prediction in t1
    await repo.create({ id: "g-empty", name: "Empty Group", ownerId: ADMIN_ID, createdAt: now });
    await repo.addMembership({ groupId: "g-empty", userId: ADMIN_ID, role: "owner", joinedAt: now });

    const groupIds = await repo.listGroupIdsByTournament("t1");
    expect(groupIds).not.toContain("g-empty");
  });

  it("listGroupIdsByTournament returns empty array for a tournament with no predictions", async () => {
    const groupIds = await repo.listGroupIdsByTournament("no-such-tournament");
    expect(groupIds).toHaveLength(0);
  });

  it("listGroupIdsByTournament returns each group only once (DISTINCT)", async () => {
    const now = new Date().toISOString();
    const client = db.$client;

    // Same tournament + matches as above (if seeded), or seed fresh:
    // Seed tournament + teams + match (may already exist from prior test — use fresh IDs)
    await client.execute({ sql: `INSERT OR IGNORE INTO tournament(id, name, created_at) VALUES ('t2', 'T2', ?)`, args: [now] });
    await client.execute({ sql: `INSERT OR IGNORE INTO team(id, tournament_id, name, code) VALUES ('team-c', 't2', 'TeamC', 'TC')`, args: [] });
    await client.execute({ sql: `INSERT OR IGNORE INTO team(id, tournament_id, name, code) VALUES ('team-d', 't2', 'TeamD', 'TD')`, args: [] });
    await client.execute({
      sql: `INSERT OR IGNORE INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at) VALUES ('m2', 't2', 'team-c', 'team-d', ?, 'finished', ?)`,
      args: [now, now],
    });
    await client.execute({
      sql: `INSERT OR IGNORE INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at) VALUES ('m3', 't2', 'team-c', 'team-d', ?, 'finished', ?)`,
      args: [now, now],
    });

    // One group, one member, predictions in BOTH matches of t2
    await repo.create({ id: "g-dup", name: "Dup Group", ownerId: OWNER_ID, createdAt: now });
    await repo.addMembership({ groupId: "g-dup", userId: OWNER_ID, role: "owner", joinedAt: now });
    await client.execute({
      sql: `INSERT INTO prediction(id, user_id, match_id, home_goals, away_goals, points, created_at, updated_at) VALUES ('pred-dup-1', ?, 'm2', 1, 0, NULL, ?, ?)`,
      args: [OWNER_ID, now, now],
    });
    await client.execute({
      sql: `INSERT INTO prediction(id, user_id, match_id, home_goals, away_goals, points, created_at, updated_at) VALUES ('pred-dup-2', ?, 'm3', 2, 1, NULL, ?, ?)`,
      args: [OWNER_ID, now, now],
    });

    const groupIds = await repo.listGroupIdsByTournament("t2");
    // Must appear only once even though OWNER_ID has 2 predictions in t2
    const g_dup_count = groupIds.filter((id) => id === "g-dup").length;
    expect(g_dup_count).toBe(1);
  });
});

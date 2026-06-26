/**
 * TDD: InvitationRepository adapter tests — task 2.8 RED → 2.9 GREEN
 *
 * Integration tests against in-memory libSQL.
 * Proves the adapter correctly implements the InvitationRepository port.
 *
 * Spec (groups): invite token generation, status transitions, active-by-group lookup.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "./test-helpers";
import { DrizzleInvitationRepository } from "./invitation-repository";
import type { DrizzleDb } from "#/infra/db/client";

let db: DrizzleDb & { $client: Client };
let repo: DrizzleInvitationRepository;

const OWNER_ID = "user-inv-owner";
const GROUP_ID = "group-inv-test";

async function seedFixtures(client: Client): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`,
    args: [OWNER_ID, "Owner", "owner@inv.test", now, now],
  });
  await client.execute({
    sql: `INSERT INTO "group"(id, name, owner_id, created_at) VALUES (?, ?, ?, ?)`,
    args: [GROUP_ID, "Inv Test Group", OWNER_ID, now],
  });
}

describe("DrizzleInvitationRepository", () => {
  beforeEach(async () => {
    db = await createTestDb();
    repo = new DrizzleInvitationRepository(db);
    await seedFixtures(db.$client);
  });

  it("create persists an invitation and getByToken returns it", async () => {
    const now = new Date().toISOString();
    const inv = await repo.create({
      id: "inv-1",
      groupId: GROUP_ID,
      token: "tok-abc123",
      status: "pending",
      createdAt: now,
      expiresAt: null,
    });

    expect(inv.id).toBe("inv-1");

    const found = await repo.getByToken("tok-abc123");
    expect(found).not.toBeNull();
    expect(found!.groupId).toBe(GROUP_ID);
    expect(found!.status).toBe("pending");
  });

  it("getByToken returns null for a missing token", async () => {
    const found = await repo.getByToken("no-such-token");
    expect(found).toBeNull();
  });

  it("updateStatus transitions pending → accepted", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "inv-2", groupId: GROUP_ID, token: "tok-2", status: "pending", createdAt: now, expiresAt: null });

    await repo.updateStatus("inv-2", "accepted");

    const found = await repo.getByToken("tok-2");
    expect(found!.status).toBe("accepted");
  });

  it("updateStatus transitions pending → revoked", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "inv-3", groupId: GROUP_ID, token: "tok-3", status: "pending", createdAt: now, expiresAt: null });

    await repo.updateStatus("inv-3", "revoked");

    const found = await repo.getByToken("tok-3");
    expect(found!.status).toBe("revoked");
  });

  it("getActiveByGroup returns the pending invitation", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "inv-4", groupId: GROUP_ID, token: "tok-4", status: "pending", createdAt: now, expiresAt: null });

    const active = await repo.getActiveByGroup(GROUP_ID);
    expect(active).not.toBeNull();
    expect(active!.token).toBe("tok-4");
  });

  it("getActiveByGroup returns null when there is no pending invitation", async () => {
    const active = await repo.getActiveByGroup(GROUP_ID);
    expect(active).toBeNull();
  });

  it("getActiveByGroup ignores revoked invitations", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "inv-5", groupId: GROUP_ID, token: "tok-5", status: "revoked", createdAt: now, expiresAt: null });

    const active = await repo.getActiveByGroup(GROUP_ID);
    expect(active).toBeNull();
  });

  it("getActiveByGroup returns the most recently created pending row when multiple exist", async () => {
    const older = "2024-01-01T00:00:00.000Z";
    const newer = "2024-06-01T00:00:00.000Z";

    await repo.create({ id: "inv-old", groupId: GROUP_ID, token: "tok-old", status: "pending", createdAt: older, expiresAt: null });
    await repo.create({ id: "inv-new", groupId: GROUP_ID, token: "tok-new", status: "pending", createdAt: newer, expiresAt: null });

    const active = await repo.getActiveByGroup(GROUP_ID);
    expect(active).not.toBeNull();
    expect(active!.token).toBe("tok-new");
  });

  it("token uniqueness: duplicate token insert fails", async () => {
    const now = new Date().toISOString();
    await repo.create({ id: "inv-6", groupId: GROUP_ID, token: "tok-unique", status: "pending", createdAt: now, expiresAt: null });

    await expect(
      repo.create({ id: "inv-7", groupId: GROUP_ID, token: "tok-unique", status: "pending", createdAt: now, expiresAt: null })
    ).rejects.toThrow();
  });
});

/**
 * TDD: Groups domain — task 2.5 (RED)
 *
 * Pure domain tests for group operations. No DB, no HTTP — only port interfaces.
 * Uses InMemoryGroupRepository and InMemoryInvitationRepository stubs.
 *
 * Spec (groups):
 *  - createGroup: owner auto-assigned as role "owner"
 *  - createGroup: name must be 1–60 chars
 *  - generateInviteToken: only owner/admin can generate
 *  - joinViaToken: creates membership with role "member"; token stays pending (reusable)
 *  - joinViaToken: already-member returns "already_member" error
 *  - joinViaToken: invalid/revoked token returns "invalid_token" error
 *  - removeMember: owner or admin can remove a member
 *  - removeMember: owner cannot remove themselves
 *  - removeMember: member cannot remove others
 *  - promoteMember: only owner can promote to admin
 *  - promoteMember: admin cannot promote to owner
 *  - revokeInvite: owner/admin can revoke active invite
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createGroup,
  generateInviteToken,
  joinViaToken,
  removeMember,
  promoteMember,
  revokeInvite,
} from "./groups";
import type {
  GroupRepository,
  InvitationRepository,
  GroupRecord,
  GroupMembershipRecord,
  InvitationRecord,
} from "./ports/repositories";

// --- In-memory stubs ---

class InMemoryGroupRepo implements GroupRepository {
  groups: Map<string, GroupRecord> = new Map();
  memberships: Map<string, GroupMembershipRecord[]> = new Map(); // keyed by groupId

  async getById(id: string): Promise<GroupRecord | null> {
    return this.groups.get(id) ?? null;
  }

  async create(group: GroupRecord): Promise<GroupRecord> {
    this.groups.set(group.id, group);
    return group;
  }

  async addMembership(membership: GroupMembershipRecord): Promise<void> {
    const list = this.memberships.get(membership.groupId) ?? [];
    list.push(membership);
    this.memberships.set(membership.groupId, list);
  }

  async getMembership(groupId: string, userId: string): Promise<GroupMembershipRecord | null> {
    const list = this.memberships.get(groupId) ?? [];
    return list.find((m) => m.userId === userId) ?? null;
  }

  async listMemberships(groupId: string): Promise<GroupMembershipRecord[]> {
    return this.memberships.get(groupId) ?? [];
  }

  async updateMembershipRole(groupId: string, userId: string, role: GroupMembershipRecord["role"]): Promise<void> {
    const list = this.memberships.get(groupId) ?? [];
    const idx = list.findIndex((m) => m.userId === userId);
    if (idx !== -1) list[idx].role = role;
  }

  async removeMembership(groupId: string, userId: string): Promise<void> {
    const list = this.memberships.get(groupId) ?? [];
    this.memberships.set(groupId, list.filter((m) => m.userId !== userId));
  }

  async listByUser(userId: string): Promise<Array<GroupRecord & { role: GroupMembershipRecord["role"] }>> {
    const results: Array<GroupRecord & { role: GroupMembershipRecord["role"] }> = [];
    for (const [groupId, memberships] of this.memberships.entries()) {
      const m = memberships.find((ms) => ms.userId === userId);
      if (m) {
        const group = this.groups.get(groupId);
        if (group) results.push({ ...group, role: m.role });
      }
    }
    return results;
  }

  // Stub: not used in groups domain tests; implemented in DrizzleGroupRepository
  async listGroupIdsByTournament(_tournamentId: string): Promise<string[]> {
    return [];
  }
}

class InMemoryInvitationRepo implements InvitationRepository {
  invitations: Map<string, InvitationRecord> = new Map(); // keyed by token

  async getByToken(token: string): Promise<InvitationRecord | null> {
    return this.invitations.get(token) ?? null;
  }

  async create(invitation: InvitationRecord): Promise<InvitationRecord> {
    this.invitations.set(invitation.token, invitation);
    return invitation;
  }

  async updateStatus(id: string, status: InvitationRecord["status"]): Promise<void> {
    for (const inv of this.invitations.values()) {
      if (inv.id === id) {
        inv.status = status;
        break;
      }
    }
  }

  async getActiveByGroup(groupId: string): Promise<InvitationRecord | null> {
    for (const inv of this.invitations.values()) {
      if (inv.groupId === groupId && inv.status === "pending") return inv;
    }
    return null;
  }
}

// --- Tests ---

let groupRepo: InMemoryGroupRepo;
let invitationRepo: InMemoryInvitationRepo;

beforeEach(() => {
  groupRepo = new InMemoryGroupRepo();
  invitationRepo = new InMemoryInvitationRepo();
});

describe("createGroup", () => {
  it("creates the group with the caller as owner", async () => {
    const result = await createGroup(
      { name: "Champions", ownerId: "user-1" },
      groupRepo
    );

    expect(result.group.name).toBe("Champions");
    expect(result.group.ownerId).toBe("user-1");

    const membership = await groupRepo.getMembership(result.group.id, "user-1");
    expect(membership?.role).toBe("owner");
  });

  it("assigns a unique id to the group", async () => {
    const r1 = await createGroup({ name: "Group A", ownerId: "u1" }, groupRepo);
    const r2 = await createGroup({ name: "Group B", ownerId: "u2" }, groupRepo);
    expect(r1.group.id).not.toBe(r2.group.id);
  });

  it("rejects an empty group name", async () => {
    await expect(
      createGroup({ name: "", ownerId: "user-1" }, groupRepo)
    ).rejects.toThrow(/name/i);
  });

  it("rejects a name longer than 60 characters", async () => {
    const longName = "a".repeat(61);
    await expect(
      createGroup({ name: longName, ownerId: "user-1" }, groupRepo)
    ).rejects.toThrow(/name/i);
  });

  it("accepts exactly 60 character name", async () => {
    const maxName = "a".repeat(60);
    const result = await createGroup({ name: maxName, ownerId: "user-1" }, groupRepo);
    expect(result.group.name).toBe(maxName);
  });
});

describe("generateInviteToken", () => {
  it("owner can generate an invite token", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);

    const result = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );

    expect(result.invitation.token).toBeTruthy();
    expect(result.invitation.groupId).toBe(group.id);
    expect(result.invitation.status).toBe("pending");
  });

  it("admin can generate an invite token", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "admin-1", role: "admin", joinedAt: new Date().toISOString() });

    const result = await generateInviteToken(
      { groupId: group.id, requesterId: "admin-1" },
      groupRepo,
      invitationRepo
    );

    expect(result.invitation.token).toBeTruthy();
  });

  it("generateInviteToken returns existing pending token when one already exists — no new row created", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);

    const result1 = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );
    const result2 = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );

    // Same invitation returned — idempotent
    expect(result2.invitation.id).toBe(result1.invitation.id);
    expect(result2.invitation.token).toBe(result1.invitation.token);

    // Only one invitation row created
    let count = 0;
    for (const inv of invitationRepo.invitations.values()) {
      if (inv.groupId === group.id) count++;
    }
    expect(count).toBe(1);
  });

  it("member cannot generate an invite token (403)", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "member-1", role: "member", joinedAt: new Date().toISOString() });

    await expect(
      generateInviteToken(
        { groupId: group.id, requesterId: "member-1" },
        groupRepo,
        invitationRepo
      )
    ).rejects.toThrow(/forbidden|403|permission/i);
  });

  it("non-member cannot generate an invite token", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);

    await expect(
      generateInviteToken(
        { groupId: group.id, requesterId: "outsider" },
        groupRepo,
        invitationRepo
      )
    ).rejects.toThrow(/forbidden|403|permission|not a member/i);
  });
});

describe("joinViaToken", () => {
  it("creates a membership with role member and token remains pending (reusable link)", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    const { invitation } = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );

    await joinViaToken({ token: invitation.token, userId: "joiner-1" }, groupRepo, invitationRepo);

    const membership = await groupRepo.getMembership(group.id, "joiner-1");
    expect(membership?.role).toBe("member");

    const inv = await invitationRepo.getByToken(invitation.token);
    expect(inv?.status).toBe("pending");
  });

  it("second user joins the same group via the same token — both memberships exist, token stays pending", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    const { invitation } = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );

    await joinViaToken({ token: invitation.token, userId: "joiner-1" }, groupRepo, invitationRepo);
    await joinViaToken({ token: invitation.token, userId: "joiner-2" }, groupRepo, invitationRepo);

    const m1 = await groupRepo.getMembership(group.id, "joiner-1");
    const m2 = await groupRepo.getMembership(group.id, "joiner-2");
    expect(m1?.role).toBe("member");
    expect(m2?.role).toBe("member");

    const inv = await invitationRepo.getByToken(invitation.token);
    expect(inv?.status).toBe("pending");
  });

  it("returns already_member when user is already in the group", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "already-1", role: "member", joinedAt: new Date().toISOString() });

    const { invitation } = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );

    await expect(
      joinViaToken({ token: invitation.token, userId: "already-1" }, groupRepo, invitationRepo)
    ).rejects.toThrow(/already.*member|already_member/i);
  });

  it("throws invalid_token for a non-existent token", async () => {
    await expect(
      joinViaToken({ token: "no-such-token", userId: "user-1" }, groupRepo, invitationRepo)
    ).rejects.toThrow(/invalid.*token|not found|invalid_token/i);
  });

  it("throws invalid_token for a revoked invitation", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    const { invitation } = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );
    await invitationRepo.updateStatus(invitation.id, "revoked");

    await expect(
      joinViaToken({ token: invitation.token, userId: "user-x" }, groupRepo, invitationRepo)
    ).rejects.toThrow(/invalid.*token|revoked|invalid_token/i);
  });
});

describe("removeMember", () => {
  it("owner can remove a regular member", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "member-1", role: "member", joinedAt: new Date().toISOString() });

    await removeMember({ groupId: group.id, requesterId: "owner-1", targetUserId: "member-1" }, groupRepo);

    const membership = await groupRepo.getMembership(group.id, "member-1");
    expect(membership).toBeNull();
  });

  it("admin can remove a regular member", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "admin-1", role: "admin", joinedAt: new Date().toISOString() });
    await groupRepo.addMembership({ groupId: group.id, userId: "member-1", role: "member", joinedAt: new Date().toISOString() });

    await removeMember({ groupId: group.id, requesterId: "admin-1", targetUserId: "member-1" }, groupRepo);

    const membership = await groupRepo.getMembership(group.id, "member-1");
    expect(membership).toBeNull();
  });

  it("owner cannot remove themselves (422)", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);

    await expect(
      removeMember({ groupId: group.id, requesterId: "owner-1", targetUserId: "owner-1" }, groupRepo)
    ).rejects.toThrow(/owner|cannot remove|self/i);
  });

  it("member cannot remove another member (403)", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "member-1", role: "member", joinedAt: new Date().toISOString() });
    await groupRepo.addMembership({ groupId: group.id, userId: "member-2", role: "member", joinedAt: new Date().toISOString() });

    await expect(
      removeMember({ groupId: group.id, requesterId: "member-1", targetUserId: "member-2" }, groupRepo)
    ).rejects.toThrow(/forbidden|403|permission/i);
  });

  it("member can self-remove (leave group)", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "member-1", role: "member", joinedAt: new Date().toISOString() });

    await removeMember({ groupId: group.id, requesterId: "member-1", targetUserId: "member-1" }, groupRepo);

    const membership = await groupRepo.getMembership(group.id, "member-1");
    expect(membership).toBeNull();
  });
});

describe("promoteMember", () => {
  it("owner can promote a member to admin", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "member-1", role: "member", joinedAt: new Date().toISOString() });

    await promoteMember({ groupId: group.id, requesterId: "owner-1", targetUserId: "member-1", newRole: "admin" }, groupRepo);

    const membership = await groupRepo.getMembership(group.id, "member-1");
    expect(membership?.role).toBe("admin");
  });

  it("admin cannot promote to owner (403)", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "admin-1", role: "admin", joinedAt: new Date().toISOString() });
    await groupRepo.addMembership({ groupId: group.id, userId: "member-1", role: "member", joinedAt: new Date().toISOString() });

    await expect(
      promoteMember({ groupId: group.id, requesterId: "admin-1", targetUserId: "member-1", newRole: "owner" }, groupRepo)
    ).rejects.toThrow(/forbidden|403|only owner/i);
  });

  it("owner can demote admin to member", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "admin-1", role: "admin", joinedAt: new Date().toISOString() });

    await promoteMember({ groupId: group.id, requesterId: "owner-1", targetUserId: "admin-1", newRole: "member" }, groupRepo);

    const membership = await groupRepo.getMembership(group.id, "admin-1");
    expect(membership?.role).toBe("member");
  });
});

describe("revokeInvite", () => {
  it("owner can revoke an active invite", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    const { invitation } = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );

    await revokeInvite({ groupId: group.id, requesterId: "owner-1", invitationId: invitation.id }, groupRepo, invitationRepo);

    const inv = await invitationRepo.getByToken(invitation.token);
    expect(inv?.status).toBe("revoked");
  });

  it("admin can revoke an active invite", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "admin-1", role: "admin", joinedAt: new Date().toISOString() });
    const { invitation } = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );

    await revokeInvite({ groupId: group.id, requesterId: "admin-1", invitationId: invitation.id }, groupRepo, invitationRepo);

    const inv = await invitationRepo.getByToken(invitation.token);
    expect(inv?.status).toBe("revoked");
  });

  it("member cannot revoke (403)", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    await groupRepo.addMembership({ groupId: group.id, userId: "member-1", role: "member", joinedAt: new Date().toISOString() });
    const { invitation } = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );

    await expect(
      revokeInvite({ groupId: group.id, requesterId: "member-1", invitationId: invitation.id }, groupRepo, invitationRepo)
    ).rejects.toThrow(/forbidden|403|permission/i);
  });

  it("revoked token can no longer be used for joining", async () => {
    const { group } = await createGroup({ name: "My Group", ownerId: "owner-1" }, groupRepo);
    const { invitation } = await generateInviteToken(
      { groupId: group.id, requesterId: "owner-1" },
      groupRepo,
      invitationRepo
    );

    await revokeInvite({ groupId: group.id, requesterId: "owner-1", invitationId: invitation.id }, groupRepo, invitationRepo);

    await expect(
      joinViaToken({ token: invitation.token, userId: "new-user" }, groupRepo, invitationRepo)
    ).rejects.toThrow(/invalid|revoked/i);
  });
});

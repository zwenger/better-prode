/**
 * Groups domain — pure group operations.
 *
 * Task 2.6 (GREEN): implements createGroup, generateInviteToken, joinViaToken,
 * removeMember, promoteMember, revokeInvite.
 *
 * Depends ONLY on repository port interfaces (no DB, no HTTP, no auth client).
 * All IDs generated here via randomUUID; all timestamps are UTC ISO strings.
 *
 * Spec (groups): invite-link-only join; owner auto-assigned; member management;
 * owner/admin roles; invite revocation.
 *
 * Design decision #1: domain depends on nothing; adapters implement ports.
 */

import { randomUUID } from "node:crypto";
import type {
  GroupRecord,
  GroupMembershipRecord,
  GroupRole,
  InvitationRecord,
  GroupRepository,
  InvitationRepository,
} from "#/domain/ports/repositories";

// Re-export domain records so callers can import from this module.
export type { GroupRecord, GroupMembershipRecord, InvitationRecord };

// ---------------------------------------------------------------------------
// createGroup
// ---------------------------------------------------------------------------

export interface CreateGroupInput {
  name: string;
  ownerId: string;
}

export interface CreateGroupResult {
  group: GroupRecord;
  membership: GroupMembershipRecord;
}

/**
 * Creates a new group and assigns the creator as owner.
 * Validates name: 1–60 characters.
 */
export async function createGroup(
  input: CreateGroupInput,
  groupRepo: GroupRepository
): Promise<CreateGroupResult> {
  if (!input.name || input.name.trim().length === 0) {
    throw Object.assign(new Error("Group name is required"), { status: 400 });
  }
  if (input.name.length > 60) {
    throw Object.assign(
      new Error("Group name must not exceed 60 characters"),
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const group: GroupRecord = {
    id: randomUUID(),
    name: input.name.trim(),
    ownerId: input.ownerId,
    createdAt: now,
  };

  await groupRepo.create(group);

  const membership: GroupMembershipRecord = {
    groupId: group.id,
    userId: input.ownerId,
    role: "owner",
    joinedAt: now,
  };

  await groupRepo.addMembership(membership);

  return { group, membership };
}

// ---------------------------------------------------------------------------
// generateInviteToken
// ---------------------------------------------------------------------------

export interface GenerateInviteTokenInput {
  groupId: string;
  requesterId: string;
}

export interface GenerateInviteTokenResult {
  invitation: InvitationRecord;
  url: string;
}

/**
 * Generates a cryptographically random invite token for a group.
 * Only owners and admins may request tokens.
 */
export async function generateInviteToken(
  input: GenerateInviteTokenInput,
  groupRepo: GroupRepository,
  invitationRepo: InvitationRepository
): Promise<GenerateInviteTokenResult> {
  const requesterMembership = await groupRepo.getMembership(input.groupId, input.requesterId);

  if (!requesterMembership) {
    throw Object.assign(
      new Error("Forbidden: not a member of this group"),
      { status: 403 }
    );
  }

  if (requesterMembership.role === "member") {
    throw Object.assign(
      new Error("Forbidden: only owners and admins can generate invite links"),
      { status: 403 }
    );
  }

  // Idempotent: return the existing active token if one already exists.
  const existing = await invitationRepo.getActiveByGroup(input.groupId);
  if (existing) {
    return { invitation: existing, url: `/invite/${existing.token}` };
  }

  const now = new Date().toISOString();
  const invitation: InvitationRecord = {
    id: randomUUID(),
    groupId: input.groupId,
    token: randomUUID(),
    status: "pending",
    createdAt: now,
    expiresAt: null,
  };

  await invitationRepo.create(invitation);

  // The URL is returned so the caller (route handler) can build the full URL.
  // Domain does not know the host — we return the path + token.
  const url = `/invite/${invitation.token}`;

  return { invitation, url };
}

// ---------------------------------------------------------------------------
// joinViaToken
// ---------------------------------------------------------------------------

export interface JoinViaTokenInput {
  token: string;
  userId: string;
}

/**
 * Joins a group via an invite token. Creates a membership with role "member".
 * The invitation token stays "pending" — group invite links are reusable, so
 * many users can join via the same link (it is NOT consumed on join).
 */
export async function joinViaToken(
  input: JoinViaTokenInput,
  groupRepo: GroupRepository,
  invitationRepo: InvitationRepository
): Promise<{ membership: GroupMembershipRecord }> {
  const invitation = await invitationRepo.getByToken(input.token);

  if (!invitation || invitation.status !== "pending") {
    throw Object.assign(
      new Error("invalid_token: Invite link is invalid or has been revoked"),
      { status: 404 }
    );
  }

  const existingMembership = await groupRepo.getMembership(invitation.groupId, input.userId);
  if (existingMembership) {
    throw Object.assign(
      new Error("already_member: You are already a member of this group"),
      { status: 422 }
    );
  }

  const now = new Date().toISOString();
  const membership: GroupMembershipRecord = {
    groupId: invitation.groupId,
    userId: input.userId,
    role: "member",
    joinedAt: now,
  };

  await groupRepo.addMembership(membership);
  // Token is intentionally NOT consumed — the invite link is reusable so
  // subsequent users can join via the same link. Invitation stays "pending".

  return { membership };
}

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

export interface RemoveMemberInput {
  groupId: string;
  requesterId: string;
  targetUserId: string;
}

/**
 * Removes a member from a group.
 * - Owner/admin can remove members.
 * - Members can only remove themselves (self-leave).
 * - Owner cannot remove themselves.
 */
export async function removeMember(
  input: RemoveMemberInput,
  groupRepo: GroupRepository
): Promise<void> {
  const requesterMembership = await groupRepo.getMembership(input.groupId, input.requesterId);

  if (!requesterMembership) {
    throw Object.assign(
      new Error("Forbidden: not a member of this group"),
      { status: 403 }
    );
  }

  // Owner cannot remove themselves
  if (requesterMembership.role === "owner" && input.requesterId === input.targetUserId) {
    throw Object.assign(
      new Error("Owner cannot remove themselves from the group"),
      { status: 422 }
    );
  }

  // Member can only self-remove
  if (requesterMembership.role === "member" && input.requesterId !== input.targetUserId) {
    throw Object.assign(
      new Error("Forbidden: members can only remove themselves"),
      { status: 403 }
    );
  }

  await groupRepo.removeMembership(input.groupId, input.targetUserId);
}

// ---------------------------------------------------------------------------
// promoteMember
// ---------------------------------------------------------------------------

export interface PromoteMemberInput {
  groupId: string;
  requesterId: string;
  targetUserId: string;
  newRole: GroupRole;
}

/**
 * Promotes or demotes a group member.
 * - Only the owner may promote/demote.
 * - No one (not even admins) can set role to "owner" except the system.
 */
export async function promoteMember(
  input: PromoteMemberInput,
  groupRepo: GroupRepository
): Promise<void> {
  const requesterMembership = await groupRepo.getMembership(input.groupId, input.requesterId);

  if (!requesterMembership || requesterMembership.role !== "owner") {
    throw Object.assign(
      new Error("Forbidden: only the group owner can promote or demote members"),
      { status: 403 }
    );
  }

  if (input.newRole === "owner") {
    throw Object.assign(
      new Error("Forbidden: only owner role transfers are not supported via promote"),
      { status: 403 }
    );
  }

  await groupRepo.updateMembershipRole(input.groupId, input.targetUserId, input.newRole);
}

// ---------------------------------------------------------------------------
// revokeInvite
// ---------------------------------------------------------------------------

export interface RevokeInviteInput {
  groupId: string;
  requesterId: string;
  invitationId: string;
}

/**
 * Revokes an active invitation. Only owners and admins may revoke.
 */
export async function revokeInvite(
  input: RevokeInviteInput,
  groupRepo: GroupRepository,
  invitationRepo: InvitationRepository
): Promise<void> {
  const requesterMembership = await groupRepo.getMembership(input.groupId, input.requesterId);

  if (!requesterMembership || requesterMembership.role === "member") {
    throw Object.assign(
      new Error("Forbidden: only owners and admins can revoke invite links"),
      { status: 403 }
    );
  }

  await invitationRepo.updateStatus(input.invitationId, "revoked");
}

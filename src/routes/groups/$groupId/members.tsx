/**
 * Route: /groups/$groupId/members
 *
 * Member list: owner/admin see remove buttons; members see a leave button;
 * owner remove-self is blocked in UI + server.
 *
 * Spec (groups): member management; owner/admin roles; owner cannot remove self.
 *
 * Task 2.13.
 */

import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { AppShell } from "#/components/app-shell";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { useEffect, useRef, useState } from "react";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { eq } from "drizzle-orm";
import { user as userTable } from "#/infra/db/schema";
// Note: we use individual selects per user because Drizzle sqlite-core's inArray
// requires additional setup; this is acceptable for small member counts (MVP).
import { DrizzleGroupRepository } from "#/adapters/db/group-repository";
import { removeMember, promoteMember } from "#/domain/groups";
import type { GroupRole } from "#/domain/ports/repositories";

interface MemberEntry {
  userId: string;
  name: string;
  email: string;
  role: GroupRole;
}

interface MembersLoaderData {
  groupId: string;
  groupName: string;
  currentUserId: string;
  currentUserRole: GroupRole;
  members: MemberEntry[];
}

interface RemoveMemberInput {
  groupId: string;
  targetUserId: string;
}

interface PromoteMemberInput {
  groupId: string;
  targetUserId: string;
  newRole: GroupRole;
}

const getMembersData = createServerFn({ method: "GET", strict: false })
  .validator((data: unknown): { groupId: string } => data as { groupId: string })
  .handler(async ({ data }): Promise<MembersLoaderData> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

    const db = getDb();
    const groupRepo = new DrizzleGroupRepository(db);

    const group = await groupRepo.getById(data.groupId);
    if (!group) {
      throw Object.assign(new Error("Group not found"), { status: 404 });
    }

    const requesterMembership = await groupRepo.getMembership(data.groupId, session.user.id);
    if (!requesterMembership) {
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    }

    const memberships = await groupRepo.listMemberships(data.groupId);

    // Fetch user details for all members
    // Build a map of userId → user info using a manual approach for compatibility
    const userIds = memberships.map((m) => m.userId);
    const userMap = new Map<string, { name: string; email: string }>();
    for (const uid of userIds) {
      const rows = await db
        .select({ id: userTable.id, name: userTable.name, email: userTable.email })
        .from(userTable)
        .where(eq(userTable.id, uid))
        .limit(1);
      if (rows[0]) userMap.set(uid, { name: rows[0].name, email: rows[0].email });
    }

    const members: MemberEntry[] = memberships.map((m) => ({
      userId: m.userId,
      name: userMap.get(m.userId)?.name ?? m.userId,
      email: userMap.get(m.userId)?.email ?? "",
      role: m.role,
    }));

    // Sort: owner first, then admins, then members
    const roleOrder: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };
    members.sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);

    return {
      groupId: data.groupId,
      groupName: group.name,
      currentUserId: session.user.id,
      currentUserRole: requesterMembership.role,
      members,
    };
  });

const removeMemberAction = createServerFn({ method: "POST" })
  .validator((data: unknown): RemoveMemberInput => data as RemoveMemberInput)
  .handler(async ({ data }): Promise<void> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

    const db = getDb();
    const groupRepo = new DrizzleGroupRepository(db);

    await removeMember(
      { groupId: data.groupId, requesterId: session.user.id, targetUserId: data.targetUserId },
      groupRepo
    );
  });

const promoteMemberAction = createServerFn({ method: "POST" })
  .validator((data: unknown): PromoteMemberInput => data as PromoteMemberInput)
  .handler(async ({ data }): Promise<void> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

    const db = getDb();
    const groupRepo = new DrizzleGroupRepository(db);

    await promoteMember(
      {
        groupId: data.groupId,
        requesterId: session.user.id,
        targetUserId: data.targetUserId,
        newRole: data.newRole,
      },
      groupRepo
    );
  });

export const Route = createFileRoute("/groups/$groupId/members")({
  loader: async ({ params }) => {
    return getMembersData({ data: { groupId: params["groupId"] } });
  },
  component: MembersPage,
});

function RoleBadge({ role }: { role: GroupRole }) {
  const labels: Record<GroupRole, string> = {
    owner: "Dueño",
    admin: "Admin",
    member: "Miembro",
  };
  const colors: Record<GroupRole, string> = {
    owner: "bg-yellow-100 text-yellow-800",
    admin: "bg-blue-100 text-blue-800",
    member: "bg-surface-subtle text-ink-muted",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[role]}`}>
      {labels[role]}
    </span>
  );
}

type MemberAction = "promote" | "remove";
const actionKey = (userId: string, action: MemberAction) => `${userId}:${action}`;

function MembersPage() {
  const { groupId } = useParams({ from: "/groups/$groupId/members" });
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const [members, setMembers] = useState<MemberEntry[]>(data.members);
  const [error, setError] = useState<string | null>(null);
  // Per-button async state, keyed by `${userId}:${action}` → "pending" | "done".
  // Mirrors the save-prediction / copy-link pattern: pending → success → revert.
  const [actionState, setActionState] = useState<Record<string, "pending" | "done" | undefined>>(
    {}
  );
  const revertTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = revertTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const clearAction = (key: string) =>
    setActionState((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const scheduleRevert = (key: string) => {
    const timer = setTimeout(() => {
      clearAction(key);
      revertTimers.current.delete(timer);
    }, 1500);
    revertTimers.current.add(timer);
  };

  const canManage = data.currentUserRole === "owner" || data.currentUserRole === "admin";

  const handleRemove = async (targetUserId: string) => {
    const key = actionKey(targetUserId, "remove");
    setError(null);
    setActionState((prev) => ({ ...prev, [key]: "pending" }));
    try {
      await removeMemberAction({ data: { groupId, targetUserId } });

      // If user removed themselves, redirect to groups index
      if (targetUserId === data.currentUserId) {
        navigate({ to: "/groups" });
        return;
      }

      // Row unmounts on success — no revert needed.
      setMembers((prev) => prev.filter((m) => m.userId !== targetUserId));
    } catch (err) {
      clearAction(key);
      setError(err instanceof Error ? err.message : "Error al eliminar miembro.");
    }
  };

  const handlePromote = async (targetUserId: string, newRole: GroupRole) => {
    const key = actionKey(targetUserId, "promote");
    setError(null);
    setActionState((prev) => ({ ...prev, [key]: "pending" }));
    try {
      await promoteMemberAction({ data: { groupId, targetUserId, newRole } });
      setMembers((prev) =>
        prev.map((m) => (m.userId === targetUserId ? { ...m, role: newRole } : m))
      );
      setActionState((prev) => ({ ...prev, [key]: "done" }));
      scheduleRevert(key);
    } catch (err) {
      clearAction(key);
      setError(err instanceof Error ? err.message : "Error al cambiar rol.");
    }
  };

  return (
    <AppShell>
    <div className="p-4 max-w-sm mx-auto" data-testid="members-page">
      <h1 className="text-2xl font-bold mb-1">{data.groupName}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {members.length} miembro{members.length !== 1 ? "s" : ""}
      </p>

      {error && (
        <p className="mb-4 text-sm text-miss-red-ink" data-testid="members-error">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {members.map((member) => {
          const isSelf = member.userId === data.currentUserId;
          const isOwner = member.role === "owner";
          const promoteState = actionState[actionKey(member.userId, "promote")];
          const removeState = actionState[actionKey(member.userId, "remove")];

          return (
            <li
              key={member.userId}
              className="flex items-center justify-between p-3 border rounded"
              data-testid="member-entry"
              data-user-id={member.userId}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{member.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                </div>
                <RoleBadge role={member.role} />
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Owner can promote/demote */}
                {data.currentUserRole === "owner" && !isSelf && !isOwner && (
                  <button
                    type="button"
                    onClick={() =>
                      handlePromote(member.userId, member.role === "admin" ? "member" : "admin")
                    }
                    disabled={promoteState === "pending"}
                    className="px-2 py-1 text-xs border rounded hover:bg-accent disabled:opacity-60"
                    data-testid="toggle-admin-btn"
                  >
                    {promoteState === "pending"
                      ? "Cambiando…"
                      : promoteState === "done"
                        ? "✓ Listo"
                        : member.role === "admin"
                          ? "Bajar a miembro"
                          : "Hacer admin"}
                  </button>
                )}

                {/* Owner cannot remove themselves (blocked in UI) */}
                {!(isSelf && isOwner) && (
                  <button
                    type="button"
                    onClick={() => handleRemove(member.userId)}
                    disabled={removeState === "pending"}
                    className={`px-2 py-1 text-xs border rounded disabled:opacity-60 ${
                      isSelf
                        ? "hover:bg-accent text-muted-foreground"
                        : canManage
                          ? "hover:bg-miss-red-tint text-miss-red-ink border-border-hairline"
                          : "hidden"
                    }`}
                    data-testid={isSelf ? "leave-group-btn" : "remove-member-btn"}
                  >
                    {removeState === "pending"
                      ? isSelf
                        ? "Saliendo…"
                        : "Eliminando…"
                      : isSelf
                        ? "Salir del grupo"
                        : "Eliminar"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex gap-2">
        <a
          href={`/groups/${groupId}/invite`}
          className="flex-1 text-center py-2 text-sm border rounded hover:bg-accent"
          data-testid="invite-link-btn"
        >
          Invitar
        </a>
        <a
          href={`/leaderboard/${groupId}`}
          className="flex-1 text-center py-2 text-sm border rounded hover:bg-accent"
          data-testid="leaderboard-link-btn"
        >
          Tabla de posiciones
        </a>
      </div>
    </div>
    </AppShell>
  );
}

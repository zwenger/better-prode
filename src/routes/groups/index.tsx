/**
 * Route: /groups/
 *
 * Empty state: authenticated user with no groups → prompt to create or paste
 * an invite link. When user has groups, shows the list.
 *
 * Spec (groups): "authenticated user who belongs to no groups → UI displays a
 * prompt to create a new group OR enter an invite code/link".
 *
 * Task 2.14.
 */

import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { useState } from "react";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { DrizzleGroupRepository } from "#/adapters/db/group-repository";
import type { GroupRole } from "#/domain/ports/repositories";

interface GroupListItem {
  id: string;
  name: string;
  role: GroupRole;
}

interface GroupsLoaderData {
  groups: GroupListItem[];
}

const getMyGroups = createServerFn({ method: "GET" }).handler(
  async (): Promise<GroupsLoaderData> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      // Spec (auth): unauthenticated access to protected routes must be denied.
      // Redirect to home (login prompt) rather than rendering empty state.
      throw redirect({ to: "/" });
    }

    const db = getDb();
    const groupRepo = new DrizzleGroupRepository(db);

    const groups = await groupRepo.listByUser(session.user.id);

    return {
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        role: g.role,
      })),
    };
  }
);

export const Route = createFileRoute("/groups/")({
  loader: async () => getMyGroups(),
  component: GroupsPage,
});

function GroupsPage() {
  const { groups } = Route.useLoaderData();
  const [inviteCode, setInviteCode] = useState("");

  const handleJoinViaCode = () => {
    if (!inviteCode.trim()) return;
    // The invite code could be a full URL or just the token
    const token = inviteCode.includes("/invite/")
      ? inviteCode.split("/invite/").pop()!
      : inviteCode.trim();
    window.location.href = `/invite/${token}`;
  };

  const roleLabels: Record<GroupRole, string> = {
    owner: "Dueño",
    admin: "Admin",
    member: "Miembro",
  };

  if (groups.length === 0) {
    return (
      <div className="p-4 max-w-sm mx-auto" data-testid="groups-empty-state">
        <h1 className="text-2xl font-bold mb-2">Tus grupos</h1>
        <p className="text-muted-foreground mb-8">
          No pertenecés a ningún grupo todavía.
        </p>

        <div className="space-y-4">
          <Link
            to="/groups/new"
            className="flex items-center justify-center w-full py-3 bg-primary text-primary-foreground rounded font-medium"
            data-testid="create-group-link"
          >
            Crear un grupo
          </Link>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">o</span>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="invite-code" className="block text-sm font-medium">
              Ingresar enlace o código de invitación
            </label>
            <div className="flex gap-2">
              <input
                id="invite-code"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="https://…/invite/…"
                className="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                data-testid="invite-code-input"
              />
              <button
                type="button"
                onClick={handleJoinViaCode}
                disabled={!inviteCode.trim()}
                className="px-4 py-2 text-sm border rounded hover:bg-accent disabled:opacity-50"
                data-testid="join-via-code-btn"
              >
                Ir
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-sm mx-auto" data-testid="groups-list-page">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tus grupos</h1>
        <Link
          to="/groups/new"
          className="text-sm px-3 py-1.5 border rounded hover:bg-accent"
          data-testid="create-group-link"
        >
          Nuevo grupo
        </Link>
      </div>

      <ul className="space-y-2">
        {groups.map((group) => (
          <li key={group.id}>
            <Link
              to="/groups/$groupId/members"
              params={{ groupId: group.id }}
              className="flex items-center justify-between p-3 border rounded hover:bg-accent"
              data-testid="group-list-item"
              data-group-id={group.id}
            >
              <span className="font-medium truncate">{group.name}</span>
              <span className="text-xs text-muted-foreground shrink-0 ml-2">
                {roleLabels[group.role]}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-6 space-y-2">
        <p className="text-sm text-muted-foreground">¿Tenés un enlace de invitación?</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="https://…/invite/…"
            className="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            data-testid="invite-code-input"
          />
          <button
            type="button"
            onClick={handleJoinViaCode}
            disabled={!inviteCode.trim()}
            className="px-4 py-2 text-sm border rounded hover:bg-accent disabled:opacity-50"
            data-testid="join-via-code-btn"
          >
            Ir
          </button>
        </div>
      </div>
    </div>
  );
}

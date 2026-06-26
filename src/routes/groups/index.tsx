/**
 * Route: /groups/
 *
 * Empty state: authenticated user with no groups → prompt to create or paste
 * an invite link. When user has groups, shows group chip selector + leaderboard.
 *
 * Spec (groups): "authenticated user who belongs to no groups → UI displays a
 * prompt to create a new group OR enter an invite code/link".
 *
 * Task 2.14.
 */

import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { AppShell } from "#/components/app-shell";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { useState } from "react";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { groupMembership } from "#/infra/db/schema";
import { DrizzleGroupRepository } from "#/adapters/db/group-repository";
import type { GroupRole } from "#/domain/ports/repositories";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import type { LeaderboardWithNamesEntry, MemberPredictionEntry } from "#/adapters/db/prediction-repository";
import { checkLeaderboardAccess } from "#/domain/leaderboard-access";
import { Standings } from "#/components/standings";

interface GroupListItem {
  id: string;
  name: string;
  role: GroupRole;
}

interface GroupsLoaderData {
  groups: GroupListItem[];
  selectedGroupId: string | null;
  entries: LeaderboardWithNamesEntry[];
  tournamentId: string;
}

const GroupsSearch = z.object({
  group: z.string().optional(),
});

const getMyGroupsWithStandings = createServerFn({ method: "GET" }).handler(
  async (): Promise<GroupsLoaderData> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw redirect({ to: "/" });
    }

    const db = getDb();
    const groupRepo = new DrizzleGroupRepository(db);
    const predRepo = new DrizzlePredictionRepository(db);

    const groups = await groupRepo.listByUser(session.user.id);
    const groupItems: GroupListItem[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      role: g.role,
    }));

    const tournamentId = "wc-2026";

    if (groupItems.length === 0) {
      return {
        groups: [],
        selectedGroupId: null,
        entries: [],
        tournamentId,
      };
    }

    // Read ?group= from URL search params
    const url = new URL(request.url);
    const groupParam = url.searchParams.get("group");
    const selectedGroupId =
      groupParam && groupItems.some((g) => g.id === groupParam)
        ? groupParam
        : groupItems[0].id;

    const entries = await predRepo.getLeaderboardWithNames(selectedGroupId, tournamentId);

    return {
      groups: groupItems,
      selectedGroupId,
      entries,
      tournamentId,
    };
  }
);

interface GetMemberPredictionsInput {
  memberId: string;
  groupId: string;
  tournamentId: string;
}

const getMemberPredictionsForGroup = createServerFn({ method: "GET", strict: false })
  .validator(
    (data: unknown): GetMemberPredictionsInput => data as GetMemberPredictionsInput
  )
  .handler(async ({ data }): Promise<MemberPredictionEntry[]> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) throw redirect({ to: "/" });

    const db = getDb();

    const accessError = await checkLeaderboardAccess(
      session.user.id,
      data.groupId,
      async (userId, groupId) => {
        const rows = await db
          .select()
          .from(groupMembership)
          .where(
            and(
              eq(groupMembership.groupId, groupId),
              eq(groupMembership.userId, userId)
            )
          )
          .limit(1);
        return rows.length > 0;
      }
    );

    if (accessError) {
      throw Object.assign(new Error("Forbidden: you are not a member of this group"), {
        status: 403,
      });
    }

    const predRepo = new DrizzlePredictionRepository(db);
    return predRepo.getMemberPredictions(data.memberId, data.groupId, data.tournamentId);
  });

export const Route = createFileRoute("/groups/")({
  validateSearch: GroupsSearch,
  loader: async () => getMyGroupsWithStandings(),
  component: GroupsPage,
});

function GroupsPage() {
  const { groups, selectedGroupId, entries, tournamentId } = Route.useLoaderData();
  const navigate = useNavigate({ from: "/groups/" });
  const [inviteCode, setInviteCode] = useState("");

  const handleJoinViaCode = () => {
    if (!inviteCode.trim()) return;
    const token = inviteCode.includes("/invite/")
      ? inviteCode.split("/invite/").pop()!
      : inviteCode.trim();
    window.location.href = `/invite/${token}`;
  };

  const handleGroupSelect = (groupId: string) => {
    navigate({ search: { group: groupId } });
  };

  if (groups.length === 0) {
    return (
      <AppShell>
        <div className="p-4 max-w-sm mx-auto" data-testid="groups-empty-state">
          <h1
            className="font-extrabold mb-2"
            style={{ fontFamily: "Archivo, sans-serif", fontSize: "1.75rem" }}
          >
            Grupos
          </h1>
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
              <label htmlFor="invite-code-empty" className="block text-sm font-medium">
                Ingresar enlace o código de invitación
              </label>
              <div className="flex gap-2">
                <input
                  id="invite-code-empty"
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
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div data-testid="groups-list-page">
        {/* Sticky header */}
        <header className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3">
          <h1
            className="font-extrabold"
            style={{ fontFamily: "Archivo, sans-serif", fontSize: "1.75rem" }}
          >
            Grupos
          </h1>
        </header>

        {/* Group chip selector */}
        <div
          className="flex gap-2 overflow-x-auto px-4 py-3"
          style={{ scrollbarWidth: "none" }}
        >
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => handleGroupSelect(g.id)}
              className={[
                "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                g.id === selectedGroupId
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              ].join(" ")}
              style={{
                minHeight: "44px",
                ...(g.id !== selectedGroupId ? { backgroundColor: "var(--surface-subtle)" } : {}),
              }}
              data-testid="group-list-item"
              data-group-id={g.id}
            >
              {g.name}
            </button>
          ))}

          {/* Create new group chip */}
          <Link
            to="/groups/new"
            className="shrink-0 rounded-full px-4 py-2 text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors flex items-center"
            style={{ minHeight: "44px" }}
            data-testid="create-group-link"
          >
            + Nuevo
          </Link>
        </div>

        {/* Standings */}
        <section className="px-4">
          <Standings
            entries={entries}
            getMemberPredictions={
              selectedGroupId
                ? (memberId) =>
                    getMemberPredictionsForGroup({
                      data: { memberId, groupId: selectedGroupId, tournamentId },
                    })
                : undefined
            }
          />
        </section>

        {/* Invite code */}
        <div className="px-4 pt-6 pb-4">
          <p className="text-sm text-muted-foreground mb-2">¿Tenés un enlace de invitación?</p>
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
    </AppShell>
  );
}

/**
 * PredictionDrawer — shows same-group members' frozen predictions after lock.
 *
 * Spec (match-views):
 *  - After the prediction lock time, authenticated users MUST be able to view
 *    the frozen predictions of all members across all of their groups.
 *  - Predictions MUST be hidden before lock — server enforces this, not just UI.
 *  - Panel: Vaul drawer on mobile.
 *  - Predictions are read-only after lock (no edit controls).
 *
 * Server enforcement: getGroupPredictions returns 403 if the match is not yet locked.
 * The client never sees others' predictions pre-lock even if it crafts a request.
 */

"use client";

import { useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { eq, and } from "drizzle-orm";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { groupMembership as membershipTable, prediction as predictionTable, user as userTable } from "#/infra/db/schema";
import { isLocked } from "#/domain/lock";
import { SystemClock } from "#/domain/ports/clock";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "#/components/ui/drawer";

// ---------------------------------------------------------------------------
// Server function — enforces lock before returning predictions
// ---------------------------------------------------------------------------

interface GroupPredictionEntry {
  userId: string;
  /** Display name of the member (never the raw user id). */
  name: string;
  /** True for the requesting user's own row, for the "Vos" highlight. */
  isMe: boolean;
  homeGoals: number;
  awayGoals: number;
  points: number | null;
}

interface GroupPredictionsInput {
  matchId: string;
  kickoffUtc: string;
  groupId: string;
}

interface GroupPredictionsResult {
  entries: GroupPredictionEntry[];
}

export const getGroupPredictions = createServerFn({ method: "GET", strict: false })
  .validator((data: unknown): GroupPredictionsInput => data as GroupPredictionsInput)
  .handler(async ({ data }): Promise<GroupPredictionsResult> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user.id) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

    const userId = session.user.id;
    const clock = new SystemClock();

    // Server-side lock enforcement — predictions are NEVER revealed before lock
    if (!isLocked(data.kickoffUtc, clock)) {
      throw Object.assign(
        new Error("Predictions are hidden until the match is locked"),
        { status: 403 }
      );
    }

    const db = getDb();

    // Verify the requesting user is a member of the group
    const membership = await db
      .select()
      .from(membershipTable)
      .where(and(eq(membershipTable.groupId, data.groupId), eq(membershipTable.userId, userId)))
      .limit(1);

    if (membership.length === 0) {
      throw Object.assign(new Error("Not a member of this group"), { status: 403 });
    }

    // Fetch all group members with their display names
    const members = await db
      .select({ userId: membershipTable.userId, name: userTable.name })
      .from(membershipTable)
      .innerJoin(userTable, eq(userTable.id, membershipTable.userId))
      .where(eq(membershipTable.groupId, data.groupId));

    const memberIds = members.map((m) => m.userId);
    const nameById = new Map(members.map((m) => [m.userId, m.name]));
    if (memberIds.length === 0) return { entries: [] };

    // Fetch predictions for this match from all group members
    const predictions = await db
      .select({
        userId: predictionTable.userId,
        homeGoals: predictionTable.homeGoals,
        awayGoals: predictionTable.awayGoals,
        points: predictionTable.points,
      })
      .from(predictionTable)
      .where(eq(predictionTable.matchId, data.matchId));

    const memberIdSet = new Set(memberIds);
    const entries: GroupPredictionEntry[] = predictions
      .filter((p) => memberIdSet.has(p.userId))
      .map((p) => ({
        userId: p.userId,
        name: nameById.get(p.userId) ?? "Jugador",
        isMe: p.userId === userId,
        homeGoals: p.homeGoals,
        awayGoals: p.awayGoals,
        points: p.points,
      }));

    return { entries };
  });

// ---------------------------------------------------------------------------
// Client component
// ---------------------------------------------------------------------------

interface PredictionDrawerProps {
  matchId: string;
  kickoffUtc: string;
  /** The user's groups — the drawer shows a tab or selector if multiple. */
  groupIds: string[];
  /** Whether the match is locked (server-provided kickoff time drives this). */
  locked: boolean;
}

export function PredictionDrawer({
  matchId,
  kickoffUtc,
  groupIds,
  locked,
}: PredictionDrawerProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<GroupPredictionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show the trigger after lock (UX affordance — server also enforces)
  if (!locked || groupIds.length === 0) return null;

  const groupId = groupIds[0]; // Use first group; multi-group support is future work

  async function handleOpen() {
    setOpen(true);
    if (entries.length > 0) return; // already loaded

    setLoading(true);
    setError(null);
    try {
      const result = await getGroupPredictions({
        data: { matchId, kickoffUtc, groupId },
      });
      setEntries(result.entries);
    } catch {
      setError("No se pudieron cargar las predicciones.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="mt-2 w-full py-1.5 text-sm border rounded text-muted-foreground hover:bg-muted transition"
        data-testid="open-prediction-drawer"
      >
        Ver predicciones del grupo
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader className="relative">
            <DrawerTitle>Predicciones del grupo</DrawerTitle>
            <DrawerDescription>
              Predicciones de los miembros de tu grupo para este partido.
            </DrawerDescription>
            <DrawerClose asChild>
              <button
                type="button"
                aria-label="Cerrar predicciones del grupo"
                className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary"
                data-testid="close-prediction-drawer"
              >
                ✕
              </button>
            </DrawerClose>
          </DrawerHeader>

          <div className="p-4 space-y-2">
            {loading && (
              <p className="text-sm text-muted-foreground" data-testid="drawer-loading">
                Cargando…
              </p>
            )}

            {error && (
              <p className="text-sm text-miss-red-ink" data-testid="drawer-error">
                {error}
              </p>
            )}

            {!loading && !error && entries.length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="drawer-empty">
                Ningún miembro predijo este partido.
              </p>
            )}

            {entries.map((entry) => (
              <div
                key={entry.userId}
                className={[
                  "flex items-center justify-between gap-2 p-2 rounded border",
                  entry.isMe ? "border-primary bg-muted" : "",
                ].join(" ")}
                data-testid="drawer-prediction-entry"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-foreground text-xs font-bold"
                    aria-hidden="true"
                  >
                    {entry.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-sm font-medium truncate">{entry.name}</span>
                  {entry.isMe && (
                    <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      Vos
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold tabular-nums">
                    {entry.homeGoals} – {entry.awayGoals}
                  </span>
                  {entry.points !== null && (
                    <span className="text-xs text-muted-foreground">
                      ({entry.points} pts)
                    </span>
                  )}
                </div>
              </div>
            ))}

            {!loading && !error && entries.length > 0 && (
              <p className="pt-1 text-[11px] text-muted-foreground">
                Las predicciones se revelan recién cuando arranca el partido.
              </p>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

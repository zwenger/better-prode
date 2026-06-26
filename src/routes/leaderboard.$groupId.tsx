/**
 * Leaderboard route — /leaderboard/$groupId
 *
 * Server loader reads cache-first (task 4.4), falls back to DB SUM on miss,
 * then populates the cache for subsequent reads.
 *
 * Spec (leaderboard): SUM aggregation at read time (scoring never re-invoked).
 * Spec (leaderboard): cache invalidated when applyMatchResult writes new points.
 *
 * W5: Requires authenticated session AND group membership before returning data.
 */

import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "#/components/app-shell";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { eq, and } from "drizzle-orm";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { groupMembership } from "#/infra/db/schema";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import type { LeaderboardWithNamesEntry, MemberPredictionEntry } from "#/adapters/db/prediction-repository";
import { checkLeaderboardAccess } from "#/domain/leaderboard-access";
import {
  NoopLeaderboardCache,
  CacheApiLeaderboardCache,
} from "#/adapters/cache/leaderboard-cache";
import type { LeaderboardCache } from "#/domain/ports/leaderboard-cache";
import { Standings } from "#/components/standings";

interface LoaderData {
  groupId: string;
  tournamentId: string;
  entries: LeaderboardWithNamesEntry[];
}

interface LeaderboardInput {
  groupId: string;
  tournamentId?: string;
}

interface GetMemberPredictionsInput {
  memberId: string;
  groupId: string;
  tournamentId: string;
}

/**
 * Resolve the leaderboard cache implementation.
 * In the Cloudflare Workers runtime the global `caches` API is available, so we
 * use CacheApiLeaderboardCache. In Node.js (SSR dev server, unit tests) `caches`
 * is not defined → fall back to NoopLeaderboardCache so reads go straight to DB.
 */
function resolveLeaderboardCache(): LeaderboardCache {
  if (typeof globalThis !== "undefined" && "caches" in globalThis) {
    return new CacheApiLeaderboardCache();
  }
  return new NoopLeaderboardCache();
}

const getLeaderboardData = createServerFn({ method: "GET", strict: false })
  .validator((data: unknown): LeaderboardInput => data as LeaderboardInput)
  .handler(async ({ data }): Promise<LoaderData> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    const db = getDb();

    const accessError = await checkLeaderboardAccess(
      session?.user.id,
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
      throw Object.assign(new Error(accessError), {
        status: accessError === "Unauthorized" ? 401 : 403,
      });
    }

    const predRepo = new DrizzlePredictionRepository(db);
    const tournamentId = data.tournamentId ?? "wc-2026";

    // Task 4.4: Cache-first read
    const cache = resolveLeaderboardCache();
    const cachedPayload = await cache.get(data.groupId, tournamentId);

    if (cachedPayload !== null) {
      const cached = JSON.parse(cachedPayload) as Array<{
        userId: string;
        totalPoints: number;
        displayName?: string;
        plenosCount?: number;
      }>;
      const entries: LeaderboardWithNamesEntry[] = cached.map((e) => ({
        userId: e.userId,
        displayName: e.displayName ?? e.userId,
        totalPoints: e.totalPoints,
        plenosCount: e.plenosCount ?? 0,
      }));
      return { groupId: data.groupId, tournamentId, entries };
    }

    // Cache miss — query DB with names
    const entries = await predRepo.getLeaderboardWithNames(data.groupId, tournamentId);

    // Populate cache (best-effort)
    try {
      await cache.set(data.groupId, tournamentId, JSON.stringify(entries));
    } catch {
      // Cache write failure is non-fatal
    }

    return { groupId: data.groupId, tournamentId, entries };
  });

const getMemberPredictionsForLeaderboard = createServerFn({
  method: "GET",
  strict: false,
})
  .validator(
    (data: unknown): GetMemberPredictionsInput => data as GetMemberPredictionsInput
  )
  .handler(async ({ data }): Promise<MemberPredictionEntry[]> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

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

export const Route = createFileRoute("/leaderboard/$groupId")({
  loader: async ({ params }) => {
    return await getLeaderboardData({ data: { groupId: params["groupId"] } });
  },
  component: LeaderboardPage,
});

function LeaderboardPage() {
  const { groupId, entries, tournamentId } = Route.useLoaderData();

  return (
    <AppShell>
      <div className="p-4 max-w-2xl mx-auto" data-testid="leaderboard">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Group: {groupId}</p>
        </header>

        <Standings
          entries={entries}
          testidPrefix="leaderboard"
          getMemberPredictions={(memberId) =>
            getMemberPredictionsForLeaderboard({
              data: { memberId, groupId, tournamentId },
            })
          }
        />
      </div>
    </AppShell>
  );
}

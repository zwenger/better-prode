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
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { eq, and } from "drizzle-orm";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { groupMembership } from "#/infra/db/schema";
import { LibSqlPredictionRepository } from "#/adapters/db/prediction-repository";
import { checkLeaderboardAccess } from "#/domain/leaderboard-access";
import {
  NoopLeaderboardCache,
  CacheApiLeaderboardCache,
} from "#/adapters/cache/leaderboard-cache";
import type { LeaderboardCache } from "#/domain/ports/leaderboard-cache";

interface LeaderboardEntry {
  userId: string;
  totalPoints: number;
  rank: number;
}

interface LoaderData {
  groupId: string;
  tournamentId: string;
  entries: LeaderboardEntry[];
}

interface LeaderboardInput {
  groupId: string;
  tournamentId?: string;
}

/**
 * Resolve the leaderboard cache implementation.
 * In the Cloudflare Workers runtime the global `caches` API is available, so we
 * use CacheApiLeaderboardCache.  In Node.js (SSR dev server, unit tests) `caches`
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

    // W5: check authentication and group membership before returning data
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

    const predRepo = new LibSqlPredictionRepository(db);

    // Default to WC 2026 tournament in tracer bullet; PR 4 will parameterize
    const tournamentId = data.tournamentId ?? "wc-2026";

    // Task 4.4: Cache-first read — check edge cache before hitting Turso.
    // On miss: query DB → populate cache for subsequent readers.
    // On settlement: applyMatchResult path invalidates the cache (via DO or admin route).
    const cache = resolveLeaderboardCache();
    const cachedPayload = await cache.get(data.groupId, tournamentId);

    if (cachedPayload !== null) {
      const cached = JSON.parse(cachedPayload) as Array<{ userId: string; totalPoints: number }>;
      const entries: LeaderboardEntry[] = cached.map((e, idx) => ({
        userId: e.userId,
        totalPoints: e.totalPoints,
        rank: idx + 1,
      }));
      return { groupId: data.groupId, tournamentId, entries };
    }

    // Cache miss — query DB
    const rawEntries = await predRepo.getLeaderboard(data.groupId, tournamentId);
    const entries: LeaderboardEntry[] = rawEntries.map((e, idx) => ({
      userId: e.userId,
      totalPoints: e.totalPoints,
      rank: idx + 1,
    }));

    // Populate cache for subsequent reads (best-effort — do not fail the request on cache error)
    try {
      await cache.set(data.groupId, tournamentId, JSON.stringify(rawEntries));
    } catch {
      // Cache write failure is non-fatal; the response is still correct
    }

    return { groupId: data.groupId, tournamentId, entries };
  });

export const Route = createFileRoute("/leaderboard/$groupId")({
  loader: async ({ params }) => {
    return await getLeaderboardData({ data: { groupId: params["groupId"] } });
  },
  component: LeaderboardPage,
});

// ---------------------------------------------------------------------------
// Rank badge — medal for top 3, number for rest
// ---------------------------------------------------------------------------

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-xl" aria-label="1st place">🥇</span>;
  if (rank === 2) return <span className="text-xl" aria-label="2nd place">🥈</span>;
  if (rank === 3) return <span className="text-xl" aria-label="3rd place">🥉</span>;
  return <span className="text-muted-foreground font-mono text-sm">#{rank}</span>;
}

// ---------------------------------------------------------------------------
// Mobile card — one card per user
// ---------------------------------------------------------------------------

function MobileLeaderboardCard({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div
      className="flex items-center justify-between p-3 rounded-lg border bg-card shadow-sm"
      data-testid="leaderboard-entry"
      data-rank={entry.rank}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 flex items-center justify-center shrink-0">
          <RankBadge rank={entry.rank} />
        </div>
        <span className="font-medium truncate">{entry.userId}</span>
      </div>
      <span
        className="font-bold text-lg tabular-nums shrink-0 ml-2"
        data-testid="leaderboard-points"
      >
        {entry.totalPoints} <span className="text-xs font-normal text-muted-foreground">pts</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop table row
// ---------------------------------------------------------------------------

function DesktopLeaderboardTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <table className="w-full text-sm" aria-label="Leaderboard">
      <thead>
        <tr className="border-b text-muted-foreground text-xs uppercase tracking-wide">
          <th className="py-2 pr-4 text-left w-12">#</th>
          <th className="py-2 pr-4 text-left">Player</th>
          <th className="py-2 text-right">Points</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr
            key={entry.userId}
            className="border-b last:border-0 hover:bg-muted/40 transition-colors"
            data-testid="leaderboard-entry"
            data-rank={entry.rank}
          >
            <td className="py-3 pr-4">
              <RankBadge rank={entry.rank} />
            </td>
            <td className="py-3 pr-4 font-medium">{entry.userId}</td>
            <td
              className="py-3 text-right font-bold tabular-nums"
              data-testid="leaderboard-points"
            >
              {entry.totalPoints}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Main leaderboard page — responsive: cards on mobile, table on desktop
// ---------------------------------------------------------------------------

function LeaderboardPage() {
  const { groupId, entries } = Route.useLoaderData();

  return (
    <div className="p-4 max-w-2xl mx-auto" data-testid="leaderboard">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Group: {groupId}</p>
      </header>

      {entries.length === 0 ? (
        <p className="text-muted-foreground" data-testid="leaderboard-empty">
          No hay predicciones todavía. ¡Sé el primero en predecir!
        </p>
      ) : (
        <>
          {/* Mobile cards (hidden on md+) */}
          <ol className="space-y-2 md:hidden" aria-label="Leaderboard">
            {entries.map((entry) => (
              <li key={entry.userId}>
                <MobileLeaderboardCard entry={entry} />
              </li>
            ))}
          </ol>

          {/* Desktop table (hidden on <md) */}
          <div className="hidden md:block">
            <DesktopLeaderboardTable entries={entries} />
          </div>
        </>
      )}
    </div>
  );
}

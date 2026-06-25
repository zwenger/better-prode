/**
 * Leaderboard route — /leaderboard/$groupId
 *
 * Server loader fetches SUM(points) per user in the group (no cache in PR 1).
 * Renders top names + points — functional, not polished.
 *
 * Spec (leaderboard): SUM aggregation at read time (scoring never re-invoked).
 * Design: leaderboard caching lands in PR 4.
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

    const rawEntries = await predRepo.getLeaderboard(data.groupId, tournamentId);
    const entries: LeaderboardEntry[] = rawEntries.map((e, idx) => ({
      userId: e.userId,
      totalPoints: e.totalPoints,
      rank: idx + 1,
    }));

    return { groupId: data.groupId, tournamentId, entries };
  });

export const Route = createFileRoute("/leaderboard/$groupId")({
  loader: async ({ params }) => {
    return await getLeaderboardData({ data: { groupId: params["groupId"] } });
  },
  component: LeaderboardPage,
});

function LeaderboardPage() {
  const { groupId, entries } = Route.useLoaderData();

  return (
    <div className="p-4 max-w-lg mx-auto" data-testid="leaderboard">
      <h1 className="text-2xl font-bold mb-4">Leaderboard</h1>
      {entries.length === 0 ? (
        <p className="text-muted-foreground" data-testid="leaderboard-empty">
          No predictions yet. Be the first to predict!
        </p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.userId}
              className="flex items-center justify-between p-3 rounded border"
              data-testid="leaderboard-entry"
            >
              <span className="font-medium">
                <span className="text-muted-foreground mr-2">#{entry.rank}</span>
                {entry.userId}
              </span>
              <span
                className="font-bold text-lg"
                data-testid="leaderboard-points"
              >
                {entry.totalPoints} pts
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-sm text-muted-foreground">Group: {groupId}</p>
    </div>
  );
}

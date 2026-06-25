/**
 * Leaderboard route — /leaderboard/$groupId
 *
 * Server loader fetches SUM(points) per user in the group (no cache in PR 1).
 * Renders top names + points — functional, not polished.
 *
 * Spec (leaderboard): SUM aggregation at read time (scoring never re-invoked).
 * Design: leaderboard caching lands in PR 4.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getDbClient } from "#/infra/db/client";
import { LibSqlPredictionRepository } from "#/adapters/db/prediction-repository";

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

const getLeaderboardData = createServerFn({ method: "GET" })
  .validator(
    (data: unknown) =>
      data as { groupId: string; tournamentId?: string }
  )
  .handler(async ({ data }): Promise<LoaderData> => {
    const db = getDbClient();
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

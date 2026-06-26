/**
 * Match detail route — /matches/$matchId
 *
 * Implements the lazy on-demand settlement trigger (spec: result-triggering):
 *   - First viewer after FT: if status==="finished" && !settledAt, dispatch
 *     to MATCH_DO so points are computed before the page renders.
 *   - Subsequent viewers: match is already settled → no dispatch.
 *   - The DO provides single-flight + idempotency for concurrent first-viewers.
 *
 * Also shows:
 *   - Match header (teams, kickoff time, status, score)
 *   - User's prediction for this match (if any)
 *   - Settlement status and points earned (after settle)
 *
 * Task 3.8/3.9 — lazy trigger wired in the server loader.
 */

import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "#/components/app-shell";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "#/infra/db/client";
import { match as matchTable, team as teamTable, prediction as predictionTable } from "#/infra/db/schema";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { env } from "cloudflare:workers";
import type { DispatchableMatch, DoDispatcher } from "./-match-lazy-trigger";
import { dispatchIfUnsettled } from "./-match-lazy-trigger";
import type { SettleCommand } from "#/workers/match-do";
import { TeamFlag } from "#/components/team-flag";
import { formatKickoffUtc } from "#/routes/matches/-match-list-loader";


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MatchDetail {
  id: string;
  homeName: string;
  homeCode: string | null;
  awayName: string;
  awayCode: string | null;
  kickoffUtc: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  groupLabel: string | null;
  settledAt: string | null;
  resultSource: string | null;
}

interface UserPrediction {
  homeGoals: number;
  awayGoals: number;
  points: number | null;
}

interface LoaderData {
  match: MatchDetail;
  prediction: UserPrediction | null;
  dispatched: boolean;
}

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

const getMatchDetail = createServerFn({ method: "GET" })
  .validator((data: unknown): { matchId: string } => {
    const raw = data as Record<string, unknown>;
    if (typeof raw["matchId"] !== "string" || !raw["matchId"]) {
      throw Object.assign(new Error("Invalid matchId"), { status: 400 });
    }
    return { matchId: raw["matchId"] };
  })
  .handler(async ({ data }): Promise<LoaderData> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    const db = getDb();
    const home = alias(teamTable, "home");
    const away = alias(teamTable, "away");

    // Load match with team names
    const rows = await db
      .select({
        id: matchTable.id,
        homeName: home.name,
        homeCode: home.code,
        awayName: away.name,
        awayCode: away.code,
        kickoffUtc: matchTable.kickoffUtc,
        status: matchTable.status,
        homeScore: matchTable.homeScore,
        awayScore: matchTable.awayScore,
        groupLabel: matchTable.groupLabel,
        settledAt: matchTable.settledAt,
        resultSource: matchTable.resultSource,
        homeTeamId: matchTable.homeTeamId,
        awayTeamId: matchTable.awayTeamId,
      })
      .from(matchTable)
      .leftJoin(home, eq(matchTable.homeTeamId, home.id))
      .leftJoin(away, eq(matchTable.awayTeamId, away.id))
      .where(eq(matchTable.id, data.matchId))
      .limit(1);

    if (rows.length === 0) {
      throw Object.assign(new Error("Match not found"), { status: 404 });
    }

    const row = rows[0];

    const matchRecord: MatchDetail = {
      id: row.id,
      homeName: row.homeName ?? row.homeTeamId,
      homeCode: row.homeCode,
      awayName: row.awayName ?? row.awayTeamId,
      awayCode: row.awayCode,
      kickoffUtc: row.kickoffUtc,
      status: row.status,
      homeScore: row.homeScore,
      awayScore: row.awayScore,
      groupLabel: row.groupLabel,
      settledAt: row.settledAt,
      resultSource: row.resultSource,
    };

    // --- Lazy on-demand trigger (spec: result-triggering) ---
    // Wire the real MATCH_DO binding as the DoDispatcher.
    const doDispatcher: DoDispatcher = {
      settle: async (payload) => {
        const doId = env.MATCH_DO.idFromName(payload.matchId);
        const stub = env.MATCH_DO.get(doId);
        const command: SettleCommand = payload;
        await stub.fetch("http://do/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        });
      },
    };

    const dispatchable: DispatchableMatch = {
      id: matchRecord.id,
      status: matchRecord.status as DispatchableMatch["status"],
      settledAt: matchRecord.settledAt,
      homeScore: matchRecord.homeScore,
      awayScore: matchRecord.awayScore,
    };

    const { dispatched } = await dispatchIfUnsettled(dispatchable, doDispatcher);

    // Load user prediction for this match (if authenticated)
    let userPrediction: UserPrediction | null = null;
    if (session?.user) {
      const predRows = await db
        .select({
          homeGoals: predictionTable.homeGoals,
          awayGoals: predictionTable.awayGoals,
          points: predictionTable.points,
        })
        .from(predictionTable)
        .where(eq(predictionTable.matchId, data.matchId))
        .limit(1);

      if (predRows.length > 0) {
        userPrediction = predRows[0];
      }
    }

    return { match: matchRecord, prediction: userPrediction, dispatched };
  });

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/matches/$matchId")({
  loader: async ({ params }) =>
    getMatchDetail({ data: { matchId: params.matchId } }),
  component: MatchDetailPage,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  if (status === "in_progress") {
    return (
      <span className="text-xs font-semibold text-red-500 uppercase">
        ● En vivo
      </span>
    );
  }
  if (status === "finished") {
    return (
      <span className="text-xs font-semibold text-muted-foreground uppercase">
        Finalizado
      </span>
    );
  }
  return null;
}

function MatchDetailPage() {
  const { match, prediction } = Route.useLoaderData();

  const kickoffLabel = formatKickoffUtc(match.kickoffUtc);

  return (
    <AppShell>
    <div className="p-4 max-w-lg mx-auto">
      {/* Match header */}
      <div className="mb-4 text-sm text-muted-foreground flex items-center gap-2">
        {match.groupLabel && <span>{match.groupLabel} ·</span>}
        <span title="tu hora local">{kickoffLabel}</span>
        <StatusBadge status={match.status} />
      </div>

      {/* Teams and score */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex flex-col items-center gap-1 flex-1">
          <TeamFlag code={match.homeCode} />
          <span className="font-medium text-center text-sm">{match.homeName}</span>
        </div>

        <div className="text-3xl font-bold tabular-nums shrink-0">
          {match.status === "scheduled"
            ? "vs"
            : `${match.homeScore ?? "–"} : ${match.awayScore ?? "–"}`}
        </div>

        <div className="flex flex-col items-center gap-1 flex-1">
          <TeamFlag code={match.awayCode} />
          <span className="font-medium text-center text-sm">{match.awayName}</span>
        </div>
      </div>

      {/* User prediction */}
      {prediction ? (
        <div className="border rounded p-4">
          <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
            Tu predicción
          </h2>
          <div className="flex items-center gap-3 text-xl font-bold tabular-nums">
            <span>{prediction.homeGoals}</span>
            <span>:</span>
            <span>{prediction.awayGoals}</span>
          </div>
          {prediction.points !== null && (
            <p className="mt-2 text-sm text-muted-foreground">
              Puntos obtenidos:{" "}
              <span className="font-semibold text-foreground">
                {prediction.points}
              </span>
            </p>
          )}
        </div>
      ) : (
        match.status === "scheduled" && (
          <p className="text-sm text-muted-foreground">
            Todavía no hiciste una predicción para este partido.
          </p>
        )
      )}
    </div>
    </AppShell>
  );
}

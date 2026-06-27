/**
 * Match detail route — /matches/$matchId  ("match hub")
 *
 * Lazy on-demand settlement trigger (spec: result-triggering) PLUS a richer
 * hub view that earns the page its place:
 *   - Editable prediction when the match is still open (steppers + save).
 *   - The user's prediction + result breakdown once locked/finished.
 *   - Group members' predictions inline (revealed after lock).
 *   - Recent form (last 5) for both teams.
 *
 * All data reuses existing sources: getTeamMatches (form), the group-prediction
 * query (same lock rule as PredictionDrawer), submitPrediction (editor).
 */

import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "#/components/app-shell";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { useState } from "react";
import { getDb } from "#/infra/db/client";
import {
  match as matchTable,
  team as teamTable,
  prediction as predictionTable,
  groupMembership as membershipTable,
  user as userTable,
} from "#/infra/db/schema";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { env } from "cloudflare:workers";
import type { DispatchableMatch, DoDispatcher } from "./-match-lazy-trigger";
import { dispatchIfUnsettled } from "./-match-lazy-trigger";
import type { SettleCommand } from "#/workers/match-do";
import { TeamFlag } from "#/components/team-flag";
import { ScoreStepper } from "#/components/score-stepper";
import { formatKickoffUtc } from "#/routes/matches/-match-list-loader";
import { DrizzleGroupRepository } from "#/adapters/db/group-repository";
import { DrizzleMatchRepository } from "#/adapters/db/match-repository";
import type { TeamMatchRow } from "#/adapters/db/match-repository";
import { isLocked } from "#/domain/lock";
import { SystemClock } from "#/domain/ports/clock";

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

interface GroupPredEntry {
  userId: string;
  name: string;
  isMe: boolean;
  homeGoals: number;
  awayGoals: number;
  points: number | null;
}

/** Recent-form outcome from the team's perspective: Ganó / Empató / Perdió. */
type FormOutcome = "G" | "E" | "P";

interface LoaderData {
  match: MatchDetail;
  prediction: UserPrediction | null;
  locked: boolean;
  groupPredictions: GroupPredEntry[];
  form: { home: FormOutcome[]; away: FormOutcome[] };
  dispatched: boolean;
}

// ---------------------------------------------------------------------------
// Form helper
// ---------------------------------------------------------------------------

function formOutcome(row: TeamMatchRow, teamCode: string): FormOutcome | null {
  if (row.homeScore === null || row.awayScore === null) return null;
  const isHome = row.homeCode?.toLowerCase() === teamCode.toLowerCase();
  const tg = isHome ? row.homeScore : row.awayScore;
  const og = isHome ? row.awayScore : row.homeScore;
  if (tg > og) return "G";
  if (tg < og) return "P";
  return "E";
}

async function recentForm(
  matchRepo: DrizzleMatchRepository,
  teamCode: string | null,
  excludeMatchId: string
): Promise<FormOutcome[]> {
  if (!teamCode) return [];
  const rows = await matchRepo.getTeamMatches(teamCode);
  return rows
    .filter((r) => r.status === "finished" && r.id !== excludeMatchId)
    .sort((a, b) => b.kickoffUtc.localeCompare(a.kickoffUtc))
    .slice(0, 5)
    .map((r) => formOutcome(r, teamCode))
    .filter((o): o is FormOutcome => o !== null);
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

    // --- Lazy on-demand settlement trigger (spec: result-triggering) ---
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

    const { dispatched } = await dispatchIfUnsettled(
      {
        id: matchRecord.id,
        status: matchRecord.status as DispatchableMatch["status"],
        settledAt: matchRecord.settledAt,
        homeScore: matchRecord.homeScore,
        awayScore: matchRecord.awayScore,
      },
      doDispatcher
    );

    const locked = isLocked(matchRecord.kickoffUtc, new SystemClock());

    // User's own prediction
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
      if (predRows.length > 0) userPrediction = predRows[0];
    }

    // Group members' predictions — only once locked (same rule as the drawer).
    let groupPredictions: GroupPredEntry[] = [];
    if (locked && session?.user) {
      const groupRepo = new DrizzleGroupRepository(db);
      const groups = await groupRepo.listByUser(session.user.id);
      const groupId = groups[0]?.id;
      if (groupId) {
        const members = await db
          .select({ userId: membershipTable.userId, name: userTable.name })
          .from(membershipTable)
          .innerJoin(userTable, eq(userTable.id, membershipTable.userId))
          .where(eq(membershipTable.groupId, groupId));
        const nameById = new Map(members.map((m) => [m.userId, m.name]));
        const memberIds = new Set(members.map((m) => m.userId));

        const preds = await db
          .select({
            userId: predictionTable.userId,
            homeGoals: predictionTable.homeGoals,
            awayGoals: predictionTable.awayGoals,
            points: predictionTable.points,
          })
          .from(predictionTable)
          .where(eq(predictionTable.matchId, data.matchId));

        groupPredictions = preds
          .filter((p) => memberIds.has(p.userId))
          .map((p) => ({
            userId: p.userId,
            name: nameById.get(p.userId) ?? "Jugador",
            isMe: p.userId === session.user.id,
            homeGoals: p.homeGoals,
            awayGoals: p.awayGoals,
            points: p.points,
          }))
          .sort((a, b) => (a.isMe === b.isMe ? 0 : a.isMe ? -1 : 1));
      }
    }

    // Recent form for both teams.
    const matchRepo = new DrizzleMatchRepository(db);
    const [homeForm, awayForm] = await Promise.all([
      recentForm(matchRepo, matchRecord.homeCode, matchRecord.id),
      recentForm(matchRepo, matchRecord.awayCode, matchRecord.id),
    ]);

    return {
      match: matchRecord,
      prediction: userPrediction,
      locked,
      groupPredictions,
      form: { home: homeForm, away: awayForm },
      dispatched,
    };
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
// Small pieces
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  if (status === "in_progress") {
    return (
      <span className="text-xs font-semibold uppercase" style={{ color: "var(--live-red)" }}>
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

/** Points pill — gold for a pleno (7), green when scoring, red on a miss. */
function PointsBadge({ points }: { points: number }) {
  const pleno = points === 7;
  const style: React.CSSProperties = pleno
    ? { backgroundColor: "var(--glory-gold)", color: "var(--glory-gold-ink)" }
    : points > 0
      ? { backgroundColor: "var(--pitch-green-tint)", color: "var(--pitch-green-ink)" }
      : { backgroundColor: "var(--miss-red-tint)", color: "var(--miss-red-ink)" };
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums"
      style={style}
    >
      {pleno ? "✦ +7" : `+${points}`}
    </span>
  );
}

const FORM_STYLE: Record<FormOutcome, React.CSSProperties> = {
  G: { backgroundColor: "var(--pitch-green)", color: "var(--surface)" },
  E: { backgroundColor: "var(--surface-subtle)", color: "var(--ink-muted)" },
  P: { backgroundColor: "var(--miss-red)", color: "var(--surface)" },
};

function FormRow({
  name,
  code,
  outcomes,
}: {
  name: string;
  code: string | null;
  outcomes: FormOutcome[];
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <TeamFlag code={code} />
        <span className="text-sm font-medium truncate">{name}</span>
      </div>
      {outcomes.length > 0 ? (
        <div className="flex items-center gap-1 shrink-0">
          {outcomes.map((o, i) => (
            <span
              key={i}
              className="inline-flex h-5 w-[22px] items-center justify-center rounded-md text-[11px] font-bold"
              style={FORM_STYLE[o]}
            >
              {o}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground shrink-0">Sin datos</span>
      )}
    </div>
  );
}

/** Editable prediction for an open match — reuses ScoreStepper + submitPrediction. */
function PredictionEditor({
  matchId,
  initialHome,
  initialAway,
}: {
  matchId: string;
  initialHome: number;
  initialAway: number;
}) {
  const [homeGoals, setHomeGoals] = useState(initialHome);
  const [awayGoals, setAwayGoals] = useState(initialAway);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "locked" | "error">("idle");

  const handleSave = async () => {
    setState("saving");
    try {
      const { submitPrediction } = await import("#/routes/api/predictions/-submit");
      await submitPrediction({ data: { matchId, homeGoals, awayGoals } });
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setState(status === 422 ? "locked" : "error");
    }
  };

  return (
    <div className="border rounded-2xl p-4 space-y-3" data-testid="prediction-editor">
      <h2 className="text-sm font-semibold text-muted-foreground">Tu predicción</h2>
      <div className="flex items-center justify-center gap-4">
        <ScoreStepper value={homeGoals} onChange={setHomeGoals} label="home goals" />
        <span className="text-xl font-bold text-muted-foreground font-score">:</span>
        <ScoreStepper value={awayGoals} onChange={setAwayGoals} label="away goals" />
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={state === "saving"}
        className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
        data-testid="save-prediction"
      >
        {state === "saving"
          ? "Guardando…"
          : state === "saved"
            ? "¡Guardado!"
            : "Guardar predicción"}
      </button>
      {state === "locked" && (
        <p className="text-xs text-center text-muted-foreground" data-testid="prediction-locked">
          El partido ya está cerrado.
        </p>
      )}
      {state === "error" && (
        <p className="text-xs text-center" style={{ color: "var(--miss-red-ink)" }}>
          No se pudo guardar. Intentá de nuevo.
        </p>
      )}
      <p className="text-[11px] text-center text-muted-foreground">
        Se cierra 5 minutos antes del inicio
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function MatchDetailPage() {
  const { match, prediction, locked, groupPredictions, form } = Route.useLoaderData();
  const kickoffLabel = formatKickoffUtc(match.kickoffUtc);
  const isFinished = match.status === "finished";
  const isOpen = match.status === "scheduled" && !locked;

  return (
    <AppShell>
      <div className="p-4 max-w-lg mx-auto space-y-5">
        {/* Meta */}
        <div className="text-sm text-muted-foreground flex items-center justify-center gap-2">
          {match.groupLabel && <span>{match.groupLabel} ·</span>}
          <span title="tu hora local">{kickoffLabel}</span>
          <StatusBadge status={match.status} />
        </div>

        {/* Teams + score */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col items-center gap-1 flex-1">
            <TeamFlag code={match.homeCode} />
            <span className="font-medium text-center text-sm">{match.homeName}</span>
          </div>
          <div className="text-3xl font-bold tabular-nums shrink-0 font-score">
            {match.status === "scheduled"
              ? "vs"
              : `${match.homeScore ?? "–"} : ${match.awayScore ?? "–"}`}
          </div>
          <div className="flex flex-col items-center gap-1 flex-1">
            <TeamFlag code={match.awayCode} />
            <span className="font-medium text-center text-sm">{match.awayName}</span>
          </div>
        </div>

        {/* Prediction: editable when open, otherwise read-only / result */}
        {isOpen ? (
          <PredictionEditor
            matchId={match.id}
            initialHome={prediction?.homeGoals ?? 0}
            initialAway={prediction?.awayGoals ?? 0}
          />
        ) : prediction ? (
          <div className="border rounded-2xl p-4" data-testid="user-prediction">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">Tu predicción</h2>
              {isFinished && prediction.points !== null && (
                <PointsBadge points={prediction.points} />
              )}
            </div>
            <div className="mt-2 text-xl font-bold tabular-nums font-score">
              {prediction.homeGoals} : {prediction.awayGoals}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {match.status === "scheduled"
              ? "El partido está cerrado y no hiciste una predicción."
              : "No hiciste una predicción para este partido."}
          </p>
        )}

        {/* Group members' predictions (revealed after lock) */}
        {locked && groupPredictions.length > 0 && (
          <section className="space-y-2" data-testid="match-group-predictions">
            <h2 className="text-xs font-semibold text-muted-foreground">
              Predicciones del grupo
            </h2>
            <div className="space-y-1.5">
              {groupPredictions.map((e) => (
                <div
                  key={e.userId}
                  className={[
                    "flex items-center justify-between gap-2 p-2 rounded-lg border",
                    e.isMe ? "border-primary bg-muted" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-foreground text-xs font-bold">
                      {e.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm font-medium truncate">{e.name}</span>
                    {e.isMe && (
                      <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                        Vos
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold tabular-nums font-score">
                      {e.homeGoals} : {e.awayGoals}
                    </span>
                    {e.points !== null && <PointsBadge points={e.points} />}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent form */}
        {(form.home.length > 0 || form.away.length > 0) && (
          <section className="space-y-2.5" data-testid="match-form-section">
            <h2 className="text-xs font-semibold text-muted-foreground">Forma reciente</h2>
            <FormRow name={match.homeName} code={match.homeCode} outcomes={form.home} />
            <div className="h-px bg-border" />
            <FormRow name={match.awayName} code={match.awayCode} outcomes={form.away} />
          </section>
        )}
      </div>
    </AppShell>
  );
}

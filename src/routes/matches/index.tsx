/**
 * Match list route — /matches
 *
 * Production "Partidos" page with filter chips, AppShell, and on-brand card
 * components matching the today.tsx visual language.
 *
 * E2E-testid contract:
 *   match-list, match-card, submit-prediction, prediction-saved,
 *   prediction-locked, nothing-to-predict, no-matches, reminders-button,
 *   open-prediction-drawer (from PredictionDrawer)
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { usePushSubscription } from "#/hooks/usePushSubscription";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "#/infra/db/client";
import { match as matchTable, team as teamTable } from "#/infra/db/schema";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { SystemClock } from "#/domain/ports/clock";
import { submitPrediction } from "#/routes/api/predictions/-submit";
import { TeamFlag } from "#/components/team-flag";
import { ScoreStepper } from "#/components/score-stepper";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import {
  shapeMatchRows,
  formatKickoffUtc,
} from "#/routes/matches/-match-list-loader";
import type { MatchListItem } from "#/routes/matches/-match-list-loader";
import { AppShell } from "#/components/app-shell";
import { PredictionDrawer } from "#/components/prediction-drawer";
import { score } from "#/domain/scoring";
import type { GoalCount } from "#/domain/scoring";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoaderData {
  matches: MatchListItem[];
  userId: string | null;
  vapidPublicKey: string | null;
}

type FilterTab = "all" | "predict" | "live" | "results";

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

const getMatches = createServerFn({ method: "GET" }).handler(
  async (): Promise<LoaderData> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });
    const db = getDb();
    const clock = new SystemClock();

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
        homeTeamId: matchTable.homeTeamId,
        awayTeamId: matchTable.awayTeamId,
      })
      .from(matchTable)
      .leftJoin(home, eq(matchTable.homeTeamId, home.id))
      .leftJoin(away, eq(matchTable.awayTeamId, away.id))
      .orderBy(asc(matchTable.kickoffUtc))
      .limit(120);

    const userId = session?.user.id ?? null;
    let userPredictionMap = new Map<string, { homeGoals: number; awayGoals: number }>();

    if (userId) {
      const matchIds = rows.map((r) => r.id);
      const predRepo = new DrizzlePredictionRepository(db);
      const rawMap = await predRepo.findByUserForMatches(userId, matchIds);
      userPredictionMap = new Map(
        [...rawMap.entries()].map(([matchId, pred]) => [
          matchId,
          { homeGoals: pred.homeGoals, awayGoals: pred.awayGoals },
        ])
      );
    }

    const matches = shapeMatchRows(rows, userPredictionMap, clock.now());

    return {
      matches,
      userId,
      vapidPublicKey: process.env["VAPID_PUBLIC_KEY"] ?? null,
    };
  }
);

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/matches/")({
  loader: async () => getMatches(),
  component: MatchListPage,
});

// ---------------------------------------------------------------------------
// Helpers (copied from today.tsx — not exported there)
// ---------------------------------------------------------------------------

function getOutcome(g: GoalCount): "home" | "draw" | "away" {
  if (g.homeGoals > g.awayGoals) return "home";
  if (g.homeGoals < g.awayGoals) return "away";
  return "draw";
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function TeamFlagWithName({
  name,
  code,
  align,
}: {
  name: string;
  code: string | null;
  align: "left" | "right";
}) {
  return (
    <div
      className={`flex items-center gap-2 flex-1 min-w-0 ${align === "right" ? "justify-end text-right" : "justify-start"}`}
    >
      {align === "right" && (
        <span className="font-medium truncate text-sm">{name}</span>
      )}
      <TeamFlag code={code} />
      {align === "left" && (
        <span className="font-medium truncate text-sm">{name}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RemindersButton
// ---------------------------------------------------------------------------

function RemindersButton({ vapidPublicKey }: { vapidPublicKey: string }) {
  const { isSupported, isSubscribed, isLoading, error, subscribe } =
    usePushSubscription({ vapidPublicKey });

  if (!isSupported) return null;

  return (
    <div className="px-4 mb-3">
      <button
        type="button"
        onClick={() => {
          void subscribe();
        }}
        disabled={isLoading || isSubscribed}
        className="w-full py-2 px-4 rounded border border-primary text-primary text-sm font-medium disabled:opacity-50 disabled:cursor-default"
        data-testid="reminders-button"
      >
        {isLoading
          ? "Activando…"
          : isSubscribed
            ? "Recordatorios activados"
            : "Activar recordatorios"}
      </button>
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreBreakdown (adapted from today.tsx — for FinishedMatchCard)
// ---------------------------------------------------------------------------

function ResultOnlyRow({ match }: { match: MatchListItem }) {
  return (
    <div className="rounded-xl px-3 py-3 bg-muted flex items-center gap-3 mb-2">
      <div className="flex items-center gap-1 shrink-0">
        <TeamFlag code={match.homeCode} />
        <span className="text-xs font-medium text-muted-foreground">
          {match.homeCode?.toUpperCase() ?? "---"}
        </span>
      </div>
      <span className="text-xs text-muted-foreground italic flex-1">
        Sin predicción
      </span>
      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
        Res{" "}
        <span className="font-semibold text-foreground">
          {match.homeScore}–{match.awayScore}
        </span>
      </span>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-xs font-medium text-muted-foreground">
          {match.awayCode?.toUpperCase() ?? "---"}
        </span>
        <TeamFlag code={match.awayCode} />
      </div>
    </div>
  );
}

function ScoreBreakdown({ match }: { match: MatchListItem }) {
  if (!match.userPrediction) {
    return <ResultOnlyRow match={match} />;
  }

  const pick: GoalCount = {
    homeGoals: match.userPrediction.homeGoals,
    awayGoals: match.userPrediction.awayGoals,
  };
  const final: GoalCount = {
    homeGoals: match.homeScore!,
    awayGoals: match.awayScore!,
  };

  const pts = score(pick, final);
  const isPleno =
    pick.homeGoals === final.homeGoals && pick.awayGoals === final.awayGoals;

  const pickOutcome = getOutcome(pick);
  const finalOutcome = getOutcome(final);
  const outcomeCorrect = pickOutcome === finalOutcome;
  const homeExact = pick.homeGoals === final.homeGoals;
  const awayExact = pick.awayGoals === final.awayGoals;
  const outcomeLabel =
    pickOutcome === "home" ? "L" : pickOutcome === "draw" ? "E" : "V";

  const cellBase =
    "inline-flex items-center justify-center min-w-[2rem] text-center rounded px-2 py-1 text-base font-semibold tabular-nums";

  const correctCellStyle = {
    backgroundColor: "var(--pitch-green-tint)",
    color: "var(--pitch-green-ink)",
  } as React.CSSProperties;

  const wrongCellStyle = {
    backgroundColor: "var(--miss-red-tint)",
    color: "var(--miss-red-ink)",
  } as React.CSSProperties;

  const containerStyle: React.CSSProperties = isPleno
    ? {
        backgroundColor: "oklch(0.98 0.04 84)",
        boxShadow: "0 0 0 2px var(--glory-gold)",
        borderRadius: "0.75rem",
        padding: "0.75rem",
        marginBottom: "0.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }
    : {
        backgroundColor: "var(--surface-subtle)",
        borderRadius: "0.75rem",
        padding: "0.75rem",
        marginBottom: "0.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      };

  const badgeStyle: React.CSSProperties = isPleno
    ? {
        backgroundColor: "var(--glory-gold)",
        color: "var(--glory-gold-ink)",
        borderRadius: "9999px",
        padding: "0.25rem 0.625rem",
        fontSize: "0.75rem",
        fontWeight: 700,
      }
    : pts >= 3
      ? {
          backgroundColor: "var(--pitch-green-tint)",
          color: "var(--pitch-green-ink)",
          borderRadius: "9999px",
          padding: "0.25rem 0.625rem",
          fontSize: "0.75rem",
          fontWeight: 700,
        }
      : {
          backgroundColor: "var(--miss-red-tint)",
          color: "var(--miss-red-ink)",
          borderRadius: "9999px",
          padding: "0.25rem 0.625rem",
          fontSize: "0.75rem",
          fontWeight: 700,
        };

  const badgeLabel = isPleno ? "PLENO ✦ +7" : `+${pts}`;

  const homeDisplayCode = match.homeCode?.toUpperCase() ?? "---";
  const awayDisplayCode = match.awayCode?.toUpperCase() ?? "---";

  return (
    <div style={containerStyle}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 shrink-0">
          <TeamFlag code={match.homeCode} />
          <span className="text-xs font-medium" style={{ color: "var(--ink-muted)" }}>
            {homeDisplayCode}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span
            className={cellBase}
            style={homeExact ? correctCellStyle : wrongCellStyle}
            aria-label={`Home goals: ${pick.homeGoals} ${homeExact ? "correct" : "wrong"}`}
          >
            {pick.homeGoals}
            <sup className="text-[0.55rem] ml-0.5">{homeExact ? "✓" : "✗"}</sup>
          </span>
          <span
            className={cellBase}
            style={outcomeCorrect ? correctCellStyle : wrongCellStyle}
            aria-label={`Result: ${outcomeLabel} ${outcomeCorrect ? "correct" : "wrong"}`}
          >
            {outcomeLabel}
            <sup className="text-[0.55rem] ml-0.5">{outcomeCorrect ? "✓" : "✗"}</sup>
          </span>
          <span
            className={cellBase}
            style={awayExact ? correctCellStyle : wrongCellStyle}
            aria-label={`Away goals: ${pick.awayGoals} ${awayExact ? "correct" : "wrong"}`}
          >
            {pick.awayGoals}
            <sup className="text-[0.55rem] ml-0.5">{awayExact ? "✓" : "✗"}</sup>
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs font-medium" style={{ color: "var(--ink-muted)" }}>
            {awayDisplayCode}
          </span>
          <TeamFlag code={match.awayCode} />
        </div>

        <span className="text-[11px] tabular-nums shrink-0" style={{ color: "var(--ink-muted)" }}>
          Res{" "}
          <span className="font-semibold" style={{ color: "var(--ink)" }}>
            {final.homeGoals}–{final.awayGoals}
          </span>
        </span>

        <span className="ml-auto shrink-0" style={badgeStyle}>
          {badgeLabel}
        </span>
      </div>

      {match.groupLabel && (
        <div>
          <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
            {match.groupLabel}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card components
// ---------------------------------------------------------------------------

/** Unlocked scheduled match — steppers + submit */
function PredictableMatchCard({
  match,
  userId,
}: {
  match: MatchListItem;
  userId: string | null;
}) {
  const [homeGoals, setHomeGoals] = useState(
    match.userPrediction?.homeGoals ?? 0
  );
  const [awayGoals, setAwayGoals] = useState(
    match.userPrediction?.awayGoals ?? 0
  );
  const [status, setStatus] = useState<
    "idle" | "submitting" | "done" | "locked" | "error"
  >("idle");
  const navigate = useNavigate();

  const hasPrediction = match.userPrediction !== null;

  const handleSubmit = async () => {
    if (!userId) {
      void navigate({ to: "/" });
      return;
    }
    setStatus("submitting");
    try {
      const result = await submitPrediction({
        data: { matchId: match.id, homeGoals, awayGoals },
      });
      setStatus(result.locked ? "locked" : "done");
    } catch {
      setStatus("error");
    }
  };

  return (
    <article
      className="bg-card border border-border rounded-lg p-4 mb-3"
      data-testid="match-card"
      data-match-id={match.id}
    >
      {/* Header: group label · kickoff time */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs font-semibold text-muted-foreground">
          {match.groupLabel ?? ""}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatKickoffUtc(match.kickoffUtc)}
        </span>
      </div>

      {/* Teams */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <TeamFlagWithName name={match.homeName} code={match.homeCode} align="left" />
        <span className="text-xs text-muted-foreground shrink-0">vs</span>
        <TeamFlagWithName name={match.awayName} code={match.awayCode} align="right" />
      </div>

      {/* Score steppers */}
      <div className="flex items-center justify-center gap-3 mb-3">
        <ScoreStepper
          value={homeGoals}
          onChange={setHomeGoals}
          disabled={status === "submitting"}
          label="home goals"
        />
        <span className="text-xl font-bold text-foreground font-score">:</span>
        <ScoreStepper
          value={awayGoals}
          onChange={setAwayGoals}
          disabled={status === "submitting"}
          label="away goals"
        />
      </div>

      {/* Submit / status */}
      {status === "done" ? (
        <p
          className="text-sm text-center font-semibold"
          style={{ color: "var(--pitch-green-ink)" }}
          data-testid="prediction-saved"
        >
          ¡Guardado!
        </p>
      ) : status === "locked" ? (
        <p
          className="mt-2 text-sm text-center text-muted-foreground"
          data-testid="prediction-locked"
        >
          El partido ya está cerrado.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={status === "submitting"}
          className="w-full py-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 transition-colors"
          data-testid="submit-prediction"
        >
          {status === "submitting"
            ? "Guardando…"
            : hasPrediction
              ? "Editar predicción"
              : "Guardar predicción"}
        </button>
      )}
      {status === "error" && (
        <p className="mt-1 text-xs text-destructive text-center">
          Error al guardar. Intentá de nuevo.
        </p>
      )}

      <PredictionDrawer
        matchId={match.id}
        kickoffUtc={match.kickoffUtc}
        locked={match.locked}
        groupIds={[]}
      />
    </article>
  );
}

/** Scheduled but locked match — disabled steppers + locked indicator */
function LockedMatchCard({ match }: { match: MatchListItem }) {
  return (
    <article
      className="bg-card border border-border rounded-lg p-4 mb-3"
      data-testid="match-card"
      data-match-id={match.id}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs font-semibold text-muted-foreground">
          {match.groupLabel ?? ""}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          Cerrado · {formatKickoffUtc(match.kickoffUtc)}
        </span>
      </div>

      {/* Teams */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <TeamFlagWithName name={match.homeName} code={match.homeCode} align="left" />
        <span className="text-xs text-muted-foreground shrink-0">vs</span>
        <TeamFlagWithName name={match.awayName} code={match.awayCode} align="right" />
      </div>

      {/* Disabled steppers (required for E2E test 4.8.4) */}
      <div className="flex items-center justify-center gap-3 mb-3">
        <ScoreStepper
          value={match.userPrediction?.homeGoals ?? 0}
          onChange={() => {}}
          disabled={true}
          label="home goals"
        />
        <span className="text-xl font-bold text-foreground font-score">:</span>
        <ScoreStepper
          value={match.userPrediction?.awayGoals ?? 0}
          onChange={() => {}}
          disabled={true}
          label="away goals"
        />
      </div>

      <p className="text-xs text-center text-muted-foreground" data-testid="prediction-locked">
        El partido ya está cerrado.
      </p>

      <PredictionDrawer
        matchId={match.id}
        kickoffUtc={match.kickoffUtc}
        locked={match.locked}
        groupIds={[]}
      />
    </article>
  );
}

/** In-progress match — live score */
function LiveResultCard({ match }: { match: MatchListItem }) {
  return (
    <article
      className="bg-card border border-border rounded-lg p-4 mb-3"
      data-testid="match-card"
      data-match-id={match.id}
    >
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs font-semibold text-muted-foreground">
          {match.groupLabel ?? ""}
        </span>
        <span
          className="text-xs font-semibold"
          style={{ color: "var(--live-red)" }}
        >
          ● EN VIVO
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <TeamFlagWithName name={match.homeName} code={match.homeCode} align="left" />
        <div
          className="shrink-0 font-bold text-2xl tabular-nums font-score"
          aria-live="polite"
        >
          {match.homeScore ?? "–"} : {match.awayScore ?? "–"}
        </div>
        <TeamFlagWithName name={match.awayName} code={match.awayCode} align="right" />
      </div>
    </article>
  );
}

/** Finished match — score breakdown */
function FinishedMatchCard({ match }: { match: MatchListItem }) {
  return (
    <article
      className="bg-card border border-border rounded-lg p-4 mb-3"
      data-testid="match-card"
      data-match-id={match.id}
    >
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs font-semibold text-muted-foreground">
          {match.groupLabel ?? ""}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatKickoffUtc(match.kickoffUtc)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <TeamFlagWithName name={match.homeName} code={match.homeCode} align="left" />
        <span className="text-xs text-muted-foreground shrink-0">vs</span>
        <TeamFlagWithName name={match.awayName} code={match.awayCode} align="right" />
      </div>

      <ScoreBreakdown match={match} />

      <PredictionDrawer
        matchId={match.id}
        kickoffUtc={match.kickoffUtc}
        locked={true}
        groupIds={[]}
      />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

function FilterChips({
  tab,
  onSelect,
}: {
  tab: FilterTab;
  onSelect: (t: FilterTab) => void;
}) {
  const chips: { key: FilterTab; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "predict", label: "Por predecir" },
    { key: "live", label: "En vivo" },
    { key: "results", label: "Resultados" },
  ];

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-3 pt-3 scrollbar-hide">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onSelect(chip.key)}
          className={[
            "shrink-0 rounded-full px-[14px] py-[6px] text-xs font-semibold transition-colors",
            tab === chip.key
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          ].join(" ")}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function MatchListPage() {
  const { matches, userId, vapidPublicKey } = Route.useLoaderData();
  const [tab, setTab] = useState<FilterTab>("all");

  const predictable = matches.filter((m) => m.status === "scheduled" && !m.locked);
  const locked = matches.filter((m) => m.status === "scheduled" && m.locked);
  const live = matches.filter((m) => m.status === "in_progress");
  const finished = matches
    .filter((m) => m.status === "finished")
    .sort((a, b) => b.kickoffUtc.localeCompare(a.kickoffUtc));

  const showPredictable =
    tab === "all" || tab === "predict";
  const showLive =
    tab === "all" || tab === "live";
  const showResults =
    tab === "all" || tab === "results";
  const showLocked =
    tab === "all";

  const isEmpty = matches.length === 0;
  const nothingToPredict =
    !isEmpty && tab === "predict" && predictable.length === 0;

  return (
    <AppShell>
      <div className="max-w-md mx-auto">
        {/* Sticky page header */}
        <header
          className="sticky top-0 z-10 bg-background border-b border-border px-4 py-4"
          style={{
            boxShadow:
              "0 1px 2px oklch(0.22 0.015 152 / 0.06), 0 2px 8px oklch(0.22 0.015 152 / 0.08)",
          }}
        >
          <h1
            className="text-foreground"
            style={{
              fontFamily: "Archivo, system-ui, sans-serif",
              fontWeight: 800,
              fontSize: "1.75rem",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            Partidos
          </h1>
        </header>

        {/* Reminders button */}
        {userId && vapidPublicKey && (
          <RemindersButton vapidPublicKey={vapidPublicKey} />
        )}

        {/* Filter chips */}
        <FilterChips tab={tab} onSelect={setTab} />

        {/* Match list */}
        <div data-testid="match-list" className="px-4">
          {/* Empty state */}
          {isEmpty && (
            <p className="text-muted-foreground py-8 text-center" data-testid="no-matches">
              No hay partidos todavía.
            </p>
          )}

          {/* Nothing to predict in predict tab */}
          {nothingToPredict && (
            <p
              className="text-muted-foreground py-8 text-center"
              data-testid="nothing-to-predict"
            >
              No hay partidos abiertos para predecir ahora mismo.
            </p>
          )}

          {/* Para predecir section */}
          {showPredictable && predictable.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.01em] mb-3 pt-4">
                Para predecir
              </h2>
              {predictable.map((m) => (
                <PredictableMatchCard key={m.id} match={m} userId={userId} />
              ))}
            </section>
          )}

          {/* En vivo section */}
          {showLive && live.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.01em] mb-3 pt-4">
                En vivo
              </h2>
              {live.map((m) => (
                <LiveResultCard key={m.id} match={m} />
              ))}
            </section>
          )}

          {/* Live tab — no live matches */}
          {tab === "live" && live.length === 0 && !isEmpty && (
            <p className="text-muted-foreground py-8 text-center">
              No hay partidos en vivo ahora mismo.
            </p>
          )}

          {/* Resultados section */}
          {showResults && finished.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.01em] mb-3 pt-4">
                Resultados
              </h2>
              {finished.map((m) => (
                <FinishedMatchCard key={m.id} match={m} />
              ))}
            </section>
          )}

          {/* Results tab — no finished matches */}
          {tab === "results" && finished.length === 0 && !isEmpty && (
            <p className="text-muted-foreground py-8 text-center">
              No hay resultados todavía.
            </p>
          )}

          {/* Locked upcoming (all tab only) */}
          {showLocked && locked.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.01em] mb-3 pt-4">
                Próximos cerrados
              </h2>
              {locked.map((m) => (
                <LockedMatchCard key={m.id} match={m} />
              ))}
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}

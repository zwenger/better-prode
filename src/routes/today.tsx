/**
 * Route: /today
 *
 * Main screen — shows today's (anchor day's) matches prominently,
 * followed by upcoming days, then recent finished matches with score breakdown.
 *
 * Authentication: required. Unauthenticated → redirect to "/".
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { useState, useCallback, memo } from "react";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "#/infra/db/client";
import { match as matchTable, team as teamTable } from "#/infra/db/schema";
import { auth } from "#/infra/auth/auth";
import { SystemClock } from "#/domain/ports/clock";
import { TeamFlag } from "#/components/team-flag";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import { DrizzleGroupRepository } from "#/adapters/db/group-repository";
import {
  shapeMatchRows,
} from "#/routes/matches/-match-list-loader";
import type { MatchListItem } from "#/routes/matches/-match-list-loader";
import { score } from "#/domain/scoring";
import type { GoalCount } from "#/domain/scoring";
import { AppShell } from "#/components/app-shell";
import { TeamButton } from "#/components/team-button";
import { TeamSheet } from "#/components/team-sheet";
import { PredictableMatchCard } from "#/components/predictable-match-card";
import { PredictionDrawer } from "#/components/prediction-drawer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toLocalDateStr(kickoffUtc: string): string {
  const d = new Date(kickoffUtc);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDayLabel(dateStr: string, anchorDate: string): string {
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (dateStr === anchorDate && dateStr === todayUtc) return "Hoy";

  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ---------------------------------------------------------------------------
// Server fn
// ---------------------------------------------------------------------------

interface TodayLoaderData {
  matches: MatchListItem[];
  userId: string;
  vapidPublicKey: string | null;
  anchorDate: string;
  /** The current user's group IDs — powers the "Ver predicciones del grupo" drawer. */
  groupIds: string[];
}

const getTodayMatches = createServerFn({ method: "GET" }).handler(
  async (): Promise<TodayLoaderData> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw redirect({ to: "/" });
    }

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

    const userId = session.user.id;
    const matchIds = rows.map((r) => r.id);
    const predRepo = new DrizzlePredictionRepository(db);
    const rawMap = await predRepo.findByUserForMatches(userId, matchIds);
    const userPredictionMap = new Map(
      [...rawMap.entries()].map(([matchId, pred]) => [
        matchId,
        { homeGoals: pred.homeGoals, awayGoals: pred.awayGoals },
      ])
    );

    const matches = shapeMatchRows(rows, userPredictionMap, clock.now());

    // Determine anchor date: first calendar day >= todayUtc with scheduled matches.
    // Fallback: next day with any matches.
    const todayUtc = new Date().toISOString().slice(0, 10);

    const scheduledDates = [
      ...new Set(
        matches
          .filter((m) => m.status === "scheduled")
          .map((m) => toLocalDateStr(m.kickoffUtc))
      ),
    ].sort();

    let anchorDate =
      scheduledDates.find((d) => d >= todayUtc) ?? scheduledDates[0];

    if (!anchorDate) {
      // No scheduled matches — fall back to any date with matches
      const allDates = [
        ...new Set(matches.map((m) => toLocalDateStr(m.kickoffUtc))),
      ].sort();
      anchorDate = allDates.find((d) => d >= todayUtc) ?? (allDates.length > 0 ? allDates[0] : todayUtc);
    }

    // The user's groups — drives the "Ver predicciones del grupo" drawer.
    const groupRepo = new DrizzleGroupRepository(db);
    const userGroups = await groupRepo.listByUser(userId);
    const groupIds = userGroups.map((g) => g.id);

    return {
      matches,
      userId,
      vapidPublicKey: process.env["VAPID_PUBLIC_KEY"] ?? null,
      anchorDate,
      groupIds,
    };
  }
);

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/today")({
  loader: async () => getTodayMatches(),
  component: TodayPage,
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Sticky day-header band */
function DayHeader({
  dateStr,
  anchorDate,
}: {
  dateStr: string;
  anchorDate: string;
}) {
  const label = toDayLabel(dateStr, anchorDate);
  return (
    <div className="sticky top-[56px] z-10 bg-surface-subtle border-b border-border px-4 py-2 shadow-lifted">
      <span
        className="text-xs font-semibold tracking-[0.01em] text-muted-foreground capitalize"
        style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      >
        {label}
      </span>
    </div>
  );
}

// Note: PredictableMatchCard is now the shared component from
// src/components/predictable-match-card.tsx — imported above.

/** Locked upcoming match — no steppers */
function LockedMatchCard({
  match,
  onTeamPress,
}: {
  match: MatchListItem;
  onTeamPress: (code: string | null, name: string) => void;
}) {
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
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          Cerrado
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <TeamButton
          name={match.homeName}
          code={match.homeCode}
          align="left"
          onPress={() => onTeamPress(match.homeCode, match.homeName)}
        />
        <span className="text-xs text-muted-foreground shrink-0">vs</span>
        <TeamButton
          name={match.awayName}
          code={match.awayCode}
          align="right"
          onPress={() => onTeamPress(match.awayCode, match.awayName)}
        />
      </div>
    </article>
  );
}

/** In-progress match — live score */
function LiveMatchCard({
  match,
  onTeamPress,
  groupIds,
}: {
  match: MatchListItem;
  onTeamPress: (code: string | null, name: string) => void;
  groupIds: string[];
}) {
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
        <TeamButton
          name={match.homeName}
          code={match.homeCode}
          align="left"
          onPress={() => onTeamPress(match.homeCode, match.homeName)}
        />
        <div
          className="shrink-0 font-bold text-2xl tabular-nums font-score"
          aria-live="polite"
        >
          {match.homeScore ?? "–"} : {match.awayScore ?? "–"}
        </div>
        <TeamButton
          name={match.awayName}
          code={match.awayCode}
          align="right"
          onPress={() => onTeamPress(match.awayCode, match.awayName)}
        />
      </div>
      {match.userPrediction && (
        <p
          className="mt-3 text-center text-xs text-muted-foreground"
          data-testid="user-prediction"
        >
          Tu predicción{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {match.userPrediction.homeGoals}:{match.userPrediction.awayGoals}
          </span>
        </p>
      )}

      <PredictionDrawer
        matchId={match.id}
        kickoffUtc={match.kickoffUtc}
        locked={true}
        groupIds={groupIds}
      />
    </article>
  );
}

/** Finished match with no prediction */
function ResultOnlyRow({ match }: { match: MatchListItem }) {
  return (
    <div className="rounded-xl px-3 py-3 bg-surface-subtle flex items-center gap-3 mb-2">
      <div className="flex items-center gap-1 shrink-0">
        <TeamFlag code={match.homeCode} />
        <span className="text-xs font-medium text-muted-foreground">
          {match.homeName}
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
          {match.awayName}
        </span>
        <TeamFlag code={match.awayCode} />
      </div>
    </div>
  );
}

/** Finished match with score breakdown */
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

  function getOutcome(g: GoalCount): "home" | "draw" | "away" {
    if (g.homeGoals > g.awayGoals) return "home";
    if (g.homeGoals < g.awayGoals) return "away";
    return "draw";
  }

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

  // Pleno: subtle gold tint bg + 2px gold ring — cells still visible inside
  const containerStyle: React.CSSProperties = isPleno
    ? {
        backgroundColor: "oklch(0.98 0.04 84)",  // lightest gold tint from ramp
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

  // Points badge style — glory-gold bg + glory-gold-ink text for pleno
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

  const homeDisplayName = match.homeName;
  const awayDisplayName = match.awayName;

  return (
    <div style={containerStyle}>
      <div className="flex items-center gap-3 flex-wrap">
        {/* Home flag + code */}
        <div className="flex items-center gap-1 shrink-0">
          <TeamFlag code={match.homeCode} />
          <span
            className="text-xs font-medium"
            style={{ color: "var(--ink-muted)" }}
          >
            {homeDisplayName}
          </span>
        </div>

        {/* Three prediction cells: [home goals] [L/E/V] [away goals] — color + glyph for a11y */}
        <div className="flex items-center gap-1 shrink-0">
          <span
            className={cellBase}
            style={homeExact ? correctCellStyle : wrongCellStyle}
            aria-label={`Home goals: ${pick.homeGoals} ${homeExact ? "correct" : "wrong"}`}
          >
            {pick.homeGoals}<sup className="text-[0.55rem] ml-0.5">{homeExact ? "✓" : "✗"}</sup>
          </span>
          <span
            className={cellBase}
            style={outcomeCorrect ? correctCellStyle : wrongCellStyle}
            aria-label={`Result: ${outcomeLabel} ${outcomeCorrect ? "correct" : "wrong"}`}
          >
            {outcomeLabel}<sup className="text-[0.55rem] ml-0.5">{outcomeCorrect ? "✓" : "✗"}</sup>
          </span>
          <span
            className={cellBase}
            style={awayExact ? correctCellStyle : wrongCellStyle}
            aria-label={`Away goals: ${pick.awayGoals} ${awayExact ? "correct" : "wrong"}`}
          >
            {pick.awayGoals}<sup className="text-[0.55rem] ml-0.5">{awayExact ? "✓" : "✗"}</sup>
          </span>
        </div>

        {/* Away code + flag */}
        <div className="flex items-center gap-1 shrink-0">
          <span
            className="text-xs font-medium"
            style={{ color: "var(--ink-muted)" }}
          >
            {awayDisplayName}
          </span>
          <TeamFlag code={match.awayCode} />
        </div>

        {/* Actual result */}
        <span
          className="text-[11px] tabular-nums shrink-0"
          style={{ color: "var(--ink-muted)" }}
        >
          Res{" "}
          <span
            className="font-semibold"
            style={{ color: "var(--ink)" }}
          >
            {final.homeGoals}–{final.awayGoals}
          </span>
        </span>

        {/* Points badge — pushed right */}
        <span className="ml-auto shrink-0" style={badgeStyle}>
          {badgeLabel}
        </span>
      </div>

      {/* Group label — tertiary */}
      {match.groupLabel && (
        <div>
          <span
            className="text-[11px]"
            style={{ color: "var(--ink-muted)" }}
          >
            {match.groupLabel}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memoized predictable card — prevents re-renders on unrelated state changes
// ---------------------------------------------------------------------------

const MemoizedPredictableMatchCard = memo(PredictableMatchCard);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function TodayPage() {
  const { matches, anchorDate, groupIds } = Route.useLoaderData();
  const [teamSheet, setTeamSheet] = useState<{
    open: boolean;
    code: string | null;
    name: string;
  }>({ open: false, code: null, name: "" });

  const handleTeamPress = useCallback((code: string | null, name: string) => {
    setTeamSheet({ open: true, code, name });
  }, []);

  // Partition matches
  const upcoming = matches.filter(
    (m) => m.status === "scheduled" || m.status === "in_progress"
  );
  const finished = matches
    .filter((m) => m.status === "finished")
    .sort((a, b) => b.kickoffUtc.localeCompare(a.kickoffUtc));

  // Group upcoming by calendar day, starting from anchor
  const upcomingDays = [
    ...new Set(
      upcoming
        .map((m) => toLocalDateStr(m.kickoffUtc))
        .filter((d) => d >= anchorDate)
    ),
  ]
    .sort()
    .slice(0, 5);

  const byDay = new Map<string, MatchListItem[]>();
  for (const m of upcoming) {
    const d = toLocalDateStr(m.kickoffUtc);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(m);
  }

  const recentFinished = finished.slice(0, 5);

  const noMatches = matches.length === 0;

  return (
    <AppShell>
      <div className="max-w-md mx-auto">
        {/* Page header */}
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
            Hoy
          </h1>
        </header>

        {/* Empty state */}
        {noMatches && (
          <div className="px-4 py-16 text-center">
            <p className="text-muted-foreground text-sm">
              No hay partidos programados todavía.
            </p>
          </div>
        )}

        {/* Upcoming days */}
        {upcomingDays.map((dateStr) => {
          const dayMatches = byDay.get(dateStr) ?? [];
          return (
            <section key={dateStr}>
              <DayHeader dateStr={dateStr} anchorDate={anchorDate} />
              <div className="px-4 pt-3">
                {dayMatches.map((m) => {
                  if (m.status === "in_progress") {
                    return (
                      <LiveMatchCard
                        key={m.id}
                        match={m}
                        groupIds={groupIds}
                        onTeamPress={handleTeamPress}
                      />
                    );
                  }
                  if (m.locked) {
                    return (
                      <LockedMatchCard
                        key={m.id}
                        match={m}
                        onTeamPress={handleTeamPress}
                      />
                    );
                  }
                  return (
                    <MemoizedPredictableMatchCard
                      key={m.id}
                      match={m}
                      groupIds={groupIds}
                      onTeamPress={handleTeamPress}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Recientes section */}
        {recentFinished.length > 0 && (
          <section className="mt-2">
            <div className="px-4 py-2">
              <h2
                className="text-xs font-semibold text-muted-foreground mb-3"
                style={{ fontFamily: "Inter, system-ui, sans-serif" }}
              >
                Recientes
              </h2>
              {recentFinished.map((m) => (
                <ScoreBreakdown key={m.id} match={m} />
              ))}
            </div>
          </section>
        )}
      </div>

      <TeamSheet
        open={teamSheet.open}
        onOpenChange={(open) => setTeamSheet((prev) => ({ ...prev, open }))}
        teamCode={teamSheet.code}
        teamName={teamSheet.name}
      />
    </AppShell>
  );
}

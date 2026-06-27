/**
 * Standings — shared leaderboard component used in both /groups/ and /leaderboard/$groupId.
 *
 * Accepts data as props (no server calls inside). Parent passes getMemberPredictions
 * as a prop if the member predictions sheet is desired.
 */

import * as React from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "#/components/ui/drawer";

export interface StandingsEntry {
  userId: string;
  displayName: string;
  totalPoints: number;
  plenosCount: number;
}

export interface MemberPredictionEntry {
  predictionId: string;
  predHomeGoals: number;
  predAwayGoals: number;
  points: number | null;
  matchId: string;
  kickoffUtc: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  groupLabel: string | null;
  homeName: string;
  homeCode: string | null;
  awayName: string;
  awayCode: string | null;
}

interface StandingsProps {
  entries: StandingsEntry[];
  onMemberTap?: (userId: string, displayName: string) => void;
  getMemberPredictions?: (memberId: string) => Promise<MemberPredictionEntry[]>;
  loading?: boolean;
  testidPrefix?: string;
}

// ---------------------------------------------------------------------------
// Rank badge
// ---------------------------------------------------------------------------

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-xl" aria-label="1st place">🥇</span>;
  if (rank === 2) return <span className="text-xl" aria-label="2nd place">🥈</span>;
  if (rank === 3) return <span className="text-xl" aria-label="3rd place">🥉</span>;
  return (
    <span className="text-muted-foreground font-mono text-sm tabular-nums">
      #{rank}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function StandingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading standings">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-0 py-3 border-b border-border"
        >
          <div className="w-8 h-8 rounded-full motion-safe:animate-pulse shrink-0" style={{ backgroundColor: "var(--surface-subtle)" }} />
          <div className="flex-1 h-4 rounded motion-safe:animate-pulse" style={{ backgroundColor: "var(--surface-subtle)" }} />
          <div className="w-16 h-4 rounded motion-safe:animate-pulse shrink-0" style={{ backgroundColor: "var(--surface-subtle)" }} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score breakdown cell logic
// ---------------------------------------------------------------------------

function getOutcome(homeGoals: number, awayGoals: number): "home" | "draw" | "away" {
  if (homeGoals > awayGoals) return "home";
  if (homeGoals < awayGoals) return "away";
  return "draw";
}

function MemberPredictionRow({ entry }: { entry: MemberPredictionEntry }) {
  const isFinished = entry.status === "finished";
  const hasResult = entry.homeScore !== null && entry.awayScore !== null;

  const cellBase =
    "inline-flex items-center justify-center min-w-[2rem] text-center rounded px-2 py-1 text-base font-semibold tabular-nums";

  const correctCellStyle: React.CSSProperties = {
    backgroundColor: "var(--pitch-green-tint)",
    color: "var(--pitch-green-ink)",
  };
  const wrongCellStyle: React.CSSProperties = {
    backgroundColor: "var(--miss-red-tint)",
    color: "var(--miss-red-ink)",
  };

  const pts = entry.points ?? 0;
  const isPleno =
    isFinished &&
    hasResult &&
    entry.predHomeGoals === entry.homeScore &&
    entry.predAwayGoals === entry.awayScore;

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

  const badgeLabel = isPleno ? "✦ +7" : entry.points !== null ? `+${entry.points}` : "--";

  if (isFinished && hasResult) {
    const pickOutcome = getOutcome(entry.predHomeGoals, entry.predAwayGoals);
    const finalOutcome = getOutcome(entry.homeScore!, entry.awayScore!);
    const outcomeCorrect = pickOutcome === finalOutcome;
    const homeExact = entry.predHomeGoals === entry.homeScore;
    const awayExact = entry.predAwayGoals === entry.awayScore;
    const outcomeLabel =
      pickOutcome === "home" ? "L" : pickOutcome === "draw" ? "E" : "V";
    const homeName = entry.homeName;
    const awayName = entry.awayName;

    return (
      <div style={containerStyle}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium shrink-0" style={{ color: "var(--ink-muted)" }}>
            {homeName}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <span
              className={cellBase}
              style={homeExact ? correctCellStyle : wrongCellStyle}
              aria-label={`Home goals: ${entry.predHomeGoals} ${homeExact ? "correct" : "wrong"}`}
            >
              {entry.predHomeGoals}<sup className="text-[0.55rem] ml-0.5">{homeExact ? "✓" : "✗"}</sup>
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
              aria-label={`Away goals: ${entry.predAwayGoals} ${awayExact ? "correct" : "wrong"}`}
            >
              {entry.predAwayGoals}<sup className="text-[0.55rem] ml-0.5">{awayExact ? "✓" : "✗"}</sup>
            </span>
          </div>
          <span className="text-xs font-medium shrink-0" style={{ color: "var(--ink-muted)" }}>
            {awayName}
          </span>
          <span className="text-[11px] tabular-nums shrink-0" style={{ color: "var(--ink-muted)" }}>
            Res <span className="font-semibold" style={{ color: "var(--ink)" }}>{entry.homeScore}–{entry.awayScore}</span>
          </span>
          <span className="ml-auto shrink-0" style={badgeStyle}>{badgeLabel}</span>
        </div>
        {entry.groupLabel && (
          <div>
            <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>{entry.groupLabel}</span>
          </div>
        )}
      </div>
    );
  }

  // in_progress: show pick + live score
  const homeName = entry.homeName;
  const awayName = entry.awayName;

  return (
    <div style={{ ...containerStyle, backgroundColor: "var(--surface-subtle)" }}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium shrink-0" style={{ color: "var(--ink-muted)" }}>{homeName}</span>
        <span className="font-semibold tabular-nums shrink-0">
          {entry.predHomeGoals}–{entry.predAwayGoals}
        </span>
        <span className="text-xs shrink-0" style={{ color: "var(--ink-muted)" }}>{awayName}</span>
        {entry.homeScore !== null && entry.awayScore !== null && (
          <span className="text-[11px] tabular-nums shrink-0" style={{ color: "var(--live-red)" }}>
            {entry.homeScore}–{entry.awayScore} (en vivo)
          </span>
        )}
        <span className="ml-auto shrink-0" style={badgeStyle}>{badgeLabel}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Member predictions sheet content
// ---------------------------------------------------------------------------

interface MemberSheetState {
  open: boolean;
  userId: string;
  displayName: string;
  totalPoints: number;
  plenosCount: number;
  predictions: MemberPredictionEntry[] | null;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Main Standings component
// ---------------------------------------------------------------------------

export function Standings({
  entries,
  onMemberTap,
  getMemberPredictions,
  loading = false,
  testidPrefix = "leaderboard",
}: StandingsProps) {
  const [sheet, setSheet] = React.useState<MemberSheetState>({
    open: false,
    userId: "",
    displayName: "",
    totalPoints: 0,
    plenosCount: 0,
    predictions: null,
    loading: false,
  });

  const handleRowTap = React.useCallback(
    async (entry: StandingsEntry & { rank: number }) => {
      onMemberTap?.(entry.userId, entry.displayName);

      if (!getMemberPredictions) return;

      setSheet({
        open: true,
        userId: entry.userId,
        displayName: entry.displayName,
        totalPoints: entry.totalPoints,
        plenosCount: entry.plenosCount,
        predictions: null,
        loading: true,
      });

      try {
        const preds = await getMemberPredictions(entry.userId);
        setSheet((prev) => ({ ...prev, predictions: preds, loading: false }));
      } catch {
        setSheet((prev) => ({ ...prev, predictions: [], loading: false }));
      }
    },
    [onMemberTap, getMemberPredictions]
  );

  if (loading) {
    return <StandingsSkeleton />;
  }

  if (entries.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground py-8 text-center"
        data-testid="leaderboard-empty"
      >
        No hay predicciones todavía. ¡Sé el primero en predecir!
      </p>
    );
  }

  const ranked = entries.reduce<Array<typeof entries[number] & { rank: number }>>(
    (acc, entry, idx) => {
      const prev = idx > 0 ? acc[idx - 1] : undefined;
      const rank = prev?.totalPoints === entry.totalPoints ? prev.rank : idx + 1;
      acc.push({ ...entry, rank });
      return acc;
    },
    []
  );

  const podiumStyle = (rank: number): React.CSSProperties =>
    rank <= 3
      ? { backgroundColor: "oklch(0.98 0.04 84)" }
      : {};

  return (
    <>
      <div role="list" aria-label="Standings">
        {ranked.map((entry) => (
          <button
            key={entry.userId}
            type="button"
            role="listitem"
            onClick={() => handleRowTap(entry)}
            className="w-full flex items-center gap-3 px-0 py-3 border-b border-border text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:outline-none transition-colors hover:bg-muted/40"
            style={{ minHeight: "56px", ...podiumStyle(entry.rank) }}
            data-testid={`${testidPrefix}-entry`}
            data-rank={entry.rank}
          >
            {/* Rank badge — fixed 32px slot */}
            <span className="w-8 flex items-center justify-center shrink-0">
              <RankBadge rank={entry.rank} />
            </span>

            {/* Display name */}
            <span
              className="flex-1 font-bold truncate"
              style={{ fontFamily: "Archivo, sans-serif" }}
            >
              {entry.displayName}
            </span>

            {/* Points + plenos */}
            <span className="shrink-0 flex items-center gap-1" data-testid={`${testidPrefix}-points`}>
              {entry.plenosCount > 0 && (
                <span
                  className="text-xs tabular-nums"
                  style={{ color: "var(--glory-gold)", fontSize: "0.75rem" }}
                  aria-label={`${entry.plenosCount} plenos`}
                >
                  · {entry.plenosCount} ✦
                </span>
              )}
              <span
                className="tabular-nums font-bold"
                style={{
                  fontFamily: "Archivo, sans-serif",
                  fontSize: "1.125rem",
                  color: "var(--ink)",
                }}
              >
                {entry.totalPoints}
              </span>
              <span className="text-muted-foreground text-xs font-normal">pts</span>
            </span>
          </button>
        ))}
      </div>

      {/* Member predictions drawer */}
      {getMemberPredictions && (
        <Drawer
          open={sheet.open}
          onOpenChange={(open) => setSheet((prev) => ({ ...prev, open }))}
        >
          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader className="flex items-start justify-between">
              <div>
                <DrawerTitle>{sheet.displayName}</DrawerTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  <span className="tabular-nums font-bold" style={{ color: "var(--ink)" }}>
                    {sheet.totalPoints}
                  </span>{" "}
                  pts
                  {sheet.plenosCount > 0 && (
                    <span className="ml-2" style={{ color: "var(--glory-gold)" }}>
                      · {sheet.plenosCount} ✦
                    </span>
                  )}
                </p>
              </div>
              <DrawerClose asChild>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-2xl leading-none mt-1"
                  aria-label="Close"
                >
                  ×
                </button>
              </DrawerClose>
            </DrawerHeader>

            <div className="overflow-y-auto px-4 pb-8 flex-1">
              {sheet.loading ? (
                <StandingsSkeleton />
              ) : sheet.predictions === null || sheet.predictions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No hay predicciones disponibles.
                </p>
              ) : (
                sheet.predictions.map((pred) => (
                  <MemberPredictionRow key={pred.predictionId} entry={pred} />
                ))
              )}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}

"use client";

/**
 * TeamSheet — Vaul bottom-sheet drawer showing a team's upcoming matches and results.
 *
 * Design contract:
 *  - Pitch-green for wins, miss-red for losses, surface-subtle for draws
 *  - Flat-at-rest (no hover drop shadows)
 *  - Touch targets ≥44px, WCAG AA focus-visible
 *  - No side-stripe, no horizontal scroll
 *  - Title-case section headers
 *  - max-h-[80vh] drawer
 */

import * as React from "react";
import { useEffect, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "#/components/ui/drawer";
import { TeamFlag } from "#/components/team-flag";
import { formatKickoffUtc } from "#/routes/matches/-match-list-loader";
import { getTeamMatchesFn } from "#/routes/matches/-team-matches";
import type { TeamMatchRow } from "#/adapters/db/match-repository";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TeamSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamCode: string | null;
  teamName: string;
}

// ---------------------------------------------------------------------------
// W/D/L helpers
// ---------------------------------------------------------------------------

function teamResult(match: TeamMatchRow, teamCode: string): "W" | "D" | "L" {
  const isHome = match.homeCode?.toLowerCase() === teamCode.toLowerCase();
  const teamGoals = isHome ? match.homeScore! : match.awayScore!;
  const oppGoals = isHome ? match.awayScore! : match.homeScore!;
  if (teamGoals > oppGoals) return "W";
  if (teamGoals < oppGoals) return "L";
  return "D";
}

function opponentCode(match: TeamMatchRow, teamCode: string): string | null {
  const isHome = match.homeCode?.toLowerCase() === teamCode.toLowerCase();
  return isHome ? match.awayCode : match.homeCode;
}

function opponentName(match: TeamMatchRow, teamCode: string): string {
  const isHome = match.homeCode?.toLowerCase() === teamCode.toLowerCase();
  return isHome ? match.awayName : match.homeName;
}

function teamScore(match: TeamMatchRow, teamCode: string): string {
  const isHome = match.homeCode?.toLowerCase() === teamCode.toLowerCase();
  const tg = isHome ? match.homeScore : match.awayScore;
  const og = isHome ? match.awayScore : match.homeScore;
  return `${tg ?? "–"}–${og ?? "–"}`;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonRows() {
  return (
    <div className="space-y-3 py-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between py-2 border-b border-border motion-safe:animate-pulse"
        >
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-4 w-20 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamSheet({
  open,
  onOpenChange,
  teamCode,
  teamName,
}: TeamSheetProps) {
  const [matches, setMatches] = useState<TeamMatchRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !teamCode) return;

    let cancelled = false;
    setLoading(true);
    setError(false);
    setMatches(null);

    getTeamMatchesFn({ data: { teamCode } })
      .then((data) => {
        if (!cancelled) {
          setMatches(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, teamCode]);

  // Derived data
  const finished = matches
    ? matches
        .filter((m) => m.status === "finished")
        .sort((a, b) => b.kickoffUtc.localeCompare(a.kickoffUtc))
    : [];

  const scheduled = matches
    ? matches.filter(
        (m) => m.status === "scheduled" || m.status === "in_progress"
      )
    : [];

  const formStrip = finished.slice(0, 5);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[80vh]">
        {/* Header */}
        <DrawerHeader className="flex flex-row items-center justify-between px-4 pt-2 pb-0">
          <DrawerTitle style={{ fontFamily: "Archivo, sans-serif" }}>
            Selección: {teamName}
          </DrawerTitle>
          <DrawerClose asChild>
            <button
              type="button"
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground text-2xl leading-none mt-1 min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ×
            </button>
          </DrawerClose>
        </DrawerHeader>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-4 pb-8 flex-1">
          {/* Loading state */}
          {loading && <SkeletonRows />}

          {/* Error state */}
          {error && (
            <p
              className="text-sm py-4 text-center"
              style={{ color: "var(--miss-red-ink)" }}
            >
              No se pudo cargar el historial del equipo.
            </p>
          )}

          {/* Empty state */}
          {!loading && !error && matches && matches.length === 0 && (
            <p
              className="text-sm text-center py-8"
              style={{ color: "var(--ink-muted)" }}
            >
              No hay partidos para este equipo.
            </p>
          )}

          {/* Content */}
          {!loading && !error && matches && matches.length > 0 && teamCode && (
            <>
              {/* Form strip — last ≤5 finished results */}
              {formStrip.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4 mt-2">
                  {formStrip.map((m) => {
                    const result = teamResult(m, teamCode);
                    const oppCode = opponentCode(m, teamCode);
                    const label = `${result} ${oppCode ?? "---"}`;
                    const pillStyle: React.CSSProperties =
                      result === "W"
                        ? {
                            backgroundColor: "var(--pitch-green-tint)",
                            color: "var(--pitch-green-ink)",
                          }
                        : result === "L"
                          ? {
                              backgroundColor: "var(--miss-red-tint)",
                              color: "var(--miss-red-ink)",
                            }
                          : {
                              backgroundColor: "var(--surface-subtle)",
                              color: "var(--ink-muted)",
                            };
                    return (
                      <span
                        key={m.id}
                        role="img"
                        aria-label={`${result === "W" ? "Win" : result === "L" ? "Loss" : "Draw"} vs ${oppCode ?? "---"}`}
                        style={{
                          ...pillStyle,
                          borderRadius: "9999px",
                          padding: "4px 10px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                        }}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Próximos section */}
              <h3
                className="text-sm font-semibold mb-2"
                style={{ fontFamily: "Archivo, sans-serif" }}
              >
                Próximos
              </h3>
              {scheduled.length === 0 ? (
                <p
                  className="text-sm py-2"
                  style={{ color: "var(--ink-muted)" }}
                >
                  Sin próximos
                </p>
              ) : (
                scheduled.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between py-2 border-b border-border"
                  >
                    <div className="flex items-center gap-2">
                      <TeamFlag code={m.homeCode} />
                      <span className="text-sm font-medium">
                        {m.homeCode?.toUpperCase() ?? "---"}
                      </span>
                      <span
                        className="text-xs"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        vs
                      </span>
                      <TeamFlag code={m.awayCode} />
                      <span className="text-sm font-medium">
                        {m.awayCode?.toUpperCase() ?? "---"}
                      </span>
                    </div>
                    <span
                      className="text-xs tabular-nums"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      {formatKickoffUtc(m.kickoffUtc)}
                    </span>
                  </div>
                ))
              )}

              {/* Resultados section */}
              <h3
                className="text-sm font-semibold mb-2 mt-4"
                style={{ fontFamily: "Archivo, sans-serif" }}
              >
                Resultados
              </h3>
              {finished.length === 0 ? (
                <p
                  className="text-sm py-2"
                  style={{ color: "var(--ink-muted)" }}
                >
                  Sin resultados
                </p>
              ) : (
                finished.map((m) => {
                  const result = teamResult(m, teamCode);
                  const oppName = opponentName(m, teamCode);
                  const oppCode = opponentCode(m, teamCode);
                  const scoreDisplay = teamScore(m, teamCode);
                  const dotColor =
                    result === "W"
                      ? "var(--pitch-green)"
                      : result === "L"
                        ? "var(--miss-red)"
                        : "var(--ink-muted)";
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between py-2 border-b border-border"
                    >
                      {/* Opponent */}
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <TeamFlag code={oppCode} />
                        <span
                          className="text-sm truncate"
                          style={{ color: "var(--ink-muted)" }}
                        >
                          {oppName}
                        </span>
                      </div>
                      {/* Score */}
                      <span className="text-sm tabular-nums font-semibold mx-3">
                        {scoreDisplay}
                      </span>
                      {/* W/D/L dot */}
                      <span
                        className="w-2 h-2 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: dotColor }}
                        aria-label={
                          result === "W"
                            ? "Win"
                            : result === "L"
                              ? "Loss"
                              : "Draw"
                        }
                      />
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

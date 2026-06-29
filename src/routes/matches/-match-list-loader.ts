/**
 * Match-list loader helpers — pure shaping functions for the getMatches loader.
 *
 * Extracted to a dash-prefixed module (excluded from route tree by TanStack Router)
 * so they can be unit-tested without TanStack Start server context.
 *
 * Task 4.6: shapeMatchRows attaches userPrediction from the prediction map so
 * PredictableCard can initialize its steppers to the saved values on reload
 * (fixes the "saved prediction reverts to 0-0 on reload" bug).
 */

import { isLocked } from "#/domain/lock";
import { decodePlaceholder } from "#/domain/decode-placeholder";

/**
 * W-2 fix: format a UTC ISO kickoff string for display with a timezone label.
 *
 * Spec (match-views): "The display MUST include a timezone label or indication
 * to avoid ambiguity."
 *
 * Uses timeZoneName: "short" so the browser/runtime always appends an
 * abbreviated timezone identifier (e.g. GMT-3, UTC, EST) regardless of locale.
 * The undefined locale means the viewer's own locale is used for date/time
 * formatting — only the timezone indicator is guaranteed to appear.
 *
 * Design choice: inline in MatchHeader was the first option considered.
 * Extracted here instead because:
 *   1. It can be unit-tested without a DOM/component environment.
 *   2. The dash-prefixed module is already the home for pure match-display helpers.
 *   3. A single testable function is easier to verify against the spec requirement.
 *
 * @param kickoffUtc - ISO 8601 UTC string
 * @param timeZone   - Optional IANA timezone name (e.g. "America/Argentina/Buenos_Aires").
 *                     When omitted, the viewer's local timezone is used (runtime default).
 *                     Pass an explicit value in tests to make assertions deterministic
 *                     regardless of the CI runner's host timezone.
 */
export function formatKickoffUtc(kickoffUtc: string, timeZone?: string): string {
  // Note: timeZoneName cannot be combined with dateStyle/timeStyle (Intl spec
  // groups them in mutually exclusive option sets). Using individual component
  // options to get equivalent medium-date + short-time + short-tz-label output.
  return new Date(kickoffUtc).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  });
}

/**
 * Compact kickoff label for tight rows (team-sheet upcoming/recent lists).
 *
 * Drops the year AND the timezone label that formatKickoffUtc carries: next to
 * a full team name those make the verbose string overflow the row. Month + day
 * + time is enough context inside a team's own match list.
 *
 * @param kickoffUtc - ISO 8601 UTC string
 * @param timeZone   - Optional IANA timezone (tests pass it for determinism).
 */
export function formatKickoffShort(kickoffUtc: string, timeZone?: string): string {
  return new Date(kickoffUtc).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

export interface UserPrediction {
  homeGoals: number;
  awayGoals: number;
}

export interface MatchListItem {
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
  locked: boolean;
  /** True when both home and away team IDs are concrete (non-null). */
  predictable: boolean;
  /** Hydrated from DB on load — null when the user has no prediction yet. */
  userPrediction: UserPrediction | null;
}

/**
 * Predicate for the "Para predecir" tab on the matches list.
 *
 * A match belongs in that tab only when it is scheduled, NOT locked, AND
 * predictable (both team IDs confirmed). TBD matches (predictable=false) MUST
 * be excluded — there is nothing to predict until the teams are known.
 *
 * Extracted as a pure function so the filter rule is unit-testable without the
 * React/TanStack route context.
 */
export function isPredictableTabMatch(
  m: Pick<MatchListItem, "status" | "locked" | "predictable">
): boolean {
  return m.status === "scheduled" && !m.locked && m.predictable;
}

interface RawMatchRow {
  id: string;
  homeName: string | null;
  homeCode: string | null;
  awayName: string | null;
  awayCode: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homePlaceholder: string | null;
  awayPlaceholder: string | null;
  kickoffUtc: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  groupLabel: string | null;
}

/**
 * Shape DB rows into MatchListItem[], injecting lock state and user prediction.
 *
 * @param rows        - Raw DB rows from the match + team join
 * @param predMap     - Map<matchId, {homeGoals, awayGoals}> from findByUserForMatches
 * @param now         - Current time (injectable for deterministic tests)
 */
export function shapeMatchRows(
  rows: RawMatchRow[],
  predMap: Map<string, UserPrediction>,
  now: Date
): MatchListItem[] {
  const clock = { now: () => now };
  return rows.map((row) => ({
    id: row.id,
    // Name resolution: team join name → decoded placeholder → "Por confirmar"
    // The ?? chain ends in decodePlaceholder (guaranteed non-null string)
    // because homeTeamId is now string|null — using it as a fallback would
    // leak a null into the homeName field.
    homeName: row.homeName ?? decodePlaceholder(row.homePlaceholder),
    homeCode: row.homeCode,
    awayName: row.awayName ?? decodePlaceholder(row.awayPlaceholder),
    awayCode: row.awayCode,
    kickoffUtc: row.kickoffUtc,
    status: row.status,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    groupLabel: row.groupLabel,
    locked: isLocked(row.kickoffUtc, clock),
    predictable: row.homeTeamId != null && row.awayTeamId != null,
    userPrediction: predMap.get(row.id) ?? null,
  }));
}

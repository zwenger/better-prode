/**
 * Prediction lock — server-authoritative time gate.
 *
 * A prediction is locked when the server clock reaches or passes
 * (kickoff_utc − 5 minutes). The clock is ALWAYS injected (never
 * Date.now() directly) — design decision #2.
 *
 * Client UX may disable the stepper earlier, but the server ALWAYS
 * re-validates using this function before persisting a prediction.
 */

import type { Clock } from "./ports/clock";

const LOCK_OFFSET_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Returns true when a prediction for this match is no longer allowed.
 *
 * @param kickoffUtc - The match kickoff time (Date or ISO 8601 string, UTC)
 * @param clock      - Injectable Clock port — never use Date.now() directly
 */
export function isLocked(kickoffUtc: Date | string, clock: Clock): boolean {
  const kickoff =
    typeof kickoffUtc === "string" ? new Date(kickoffUtc) : kickoffUtc;
  const lockTime = new Date(kickoff.getTime() - LOCK_OFFSET_MS);
  return clock.now() >= lockTime;
}

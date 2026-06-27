/**
 * active-window — pure predicate for dynamic active-match gating.
 *
 * Determines whether any match is in the "active window" — i.e. it has
 * kicked off, is not yet finished, and is recent enough to be worth polling.
 *
 * Design decision #2 (result-refresh design):
 *   X = 24h default lookback. A match resolves within ~3h of kickoff, but the
 *   original 6h window permanently stranded any match that missed its
 *   settlement window (e.g. prod ran broken code, cron downtime, or a deploy
 *   gap during those hours): once kickoff aged past 6h the cron NOOPed forever
 *   and the match never self-recovered. 24h keeps polling unsettled matches for
 *   a full day so a transient gap self-heals on the next cron tick, while still
 *   stopping FIFA polling for ancient rows. The FIFA call is a single request
 *   that returns ALL matches, so a wider window costs nothing per extra match.
 *
 * Pure function — no Workers bindings, fully unit-testable.
 */

export interface ActiveWindowMatch {
  status: string;
  kickoffUtc: string;
}

/**
 * Returns true iff at least one match satisfies ALL of:
 *   1. status is "scheduled" or "in_progress" (not yet finished)
 *   2. kickoffUtc <= now (has already kicked off)
 *   3. kickoffUtc >= now - lookbackHours (within the lookback floor)
 *
 * @param matches      Candidate matches (from listUnsettled).
 * @param now          Current timestamp (injected for testability).
 * @param lookbackHours Maximum age of a kicked-off match to still poll for. Default: 24.
 */
export function hasActiveWindowMatches(
  matches: ActiveWindowMatch[],
  now: Date,
  lookbackHours = 24
): boolean {
  const nowMs = now.getTime();
  const floorMs = nowMs - lookbackHours * 60 * 60 * 1000;

  return matches.some((m) => {
    if (m.status !== "scheduled" && m.status !== "in_progress") return false;
    const kickoffMs = new Date(m.kickoffUtc).getTime();
    return kickoffMs <= nowMs && kickoffMs >= floorMs;
  });
}

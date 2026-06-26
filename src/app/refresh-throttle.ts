/**
 * refresh-throttle — pure predicates for on-demand refresh deduplication.
 *
 * The /api/refresh endpoint writes a short-TTL KV key before firing runIngest
 * so that concurrent users don't all trigger FIFA polling simultaneously.
 *
 * Design decision #4 (result-refresh design):
 *   Reuse LEADERBOARD_CACHE KV.
 *   Key: "refresh:throttle:{tournamentId}", value: "1", TTL: 60 s.
 *   shouldThrottle(kv.get(key)) → true when key is present → skip call.
 *
 * Pure functions — no Workers bindings, fully unit-testable.
 */

/**
 * Builds the KV throttle key for a given tournament id.
 *
 * @param tid DB tournament.id (e.g. "17-285023")
 */
export function throttleKey(tid: string): string {
  return `refresh:throttle:${tid}`;
}

/**
 * Returns true iff the KV value signals an active throttle window.
 * A non-null, non-empty string means the key was found and we should skip.
 *
 * @param existing  Result of kv.get(throttleKey(tid)) — null when absent.
 */
export function shouldThrottle(existing: string | null): boolean {
  return existing !== null && existing !== "";
}

/**
 * Lazy on-demand trigger domain helper — task 3.8/3.9.
 *
 * Encapsulates the "first viewer after FT → dispatch to MATCH_DO" decision.
 * Pure function: no DB, no framework, no Cloudflare bindings.
 *
 * The route loader (match detail server fn) calls this with the loaded match
 * record and a DoDispatcher adapter wired to the real MATCH_DO binding.
 *
 * Spec (result-triggering):
 *  - GIVEN a match with status==="finished" AND settledAt===null AND scores known
 *  - WHEN the first user loads the match detail
 *  - THEN dispatch to the per-match Durable Object
 *  - AND subsequent viewers with settledAt set → no-op (DO handles dedup internally)
 */

export type MatchStatus = "scheduled" | "in_progress" | "finished";

/**
 * Minimal match shape required by the dispatch decision.
 * The route loader provides the full match record; this type documents
 * which fields the helper actually reads.
 */
export interface DispatchableMatch {
  id: string;
  status: MatchStatus;
  /** ISO 8601 UTC string if settled; null if not yet settled. */
  settledAt: string | null;
  /** null when the score is not yet available from the provider. */
  homeScore: number | null;
  /** null when the score is not yet available from the provider. */
  awayScore: number | null;
}

export interface SettlePayload {
  matchId: string;
  homeScore: number;
  awayScore: number;
  status: "finished";
  source: "auto";
}

/**
 * Port interface for dispatching a settle command to the per-match DO.
 * In production, wired to the MATCH_DO Cloudflare binding.
 * In tests, replaced by a vi.fn() spy.
 */
export interface DoDispatcher {
  settle: (payload: SettlePayload) => Promise<void>;
}

export interface DispatchResult {
  dispatched: boolean;
}

/**
 * dispatchIfUnsettled — lazy on-demand settlement trigger.
 *
 * Decision logic:
 *   - status !== "finished" → do not dispatch (match not over)
 *   - settledAt !== null  → do not dispatch (already settled)
 *   - homeScore or awayScore is null → do not dispatch (no score to settle with)
 *   - Otherwise: dispatch to the DO with source="auto"
 *
 * The DO provides single-flight + idempotency; two concurrent first-viewer
 * requests will both dispatch but only one settlement runs.
 */
export async function dispatchIfUnsettled(
  match: DispatchableMatch,
  dispatcher: DoDispatcher
): Promise<DispatchResult> {
  if (match.status !== "finished") {
    return { dispatched: false };
  }

  if (match.settledAt !== null) {
    return { dispatched: false };
  }

  if (match.homeScore === null || match.awayScore === null) {
    return { dispatched: false };
  }

  await dispatcher.settle({
    matchId: match.id,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    status: "finished",
    source: "auto",
  });

  return { dispatched: true };
}

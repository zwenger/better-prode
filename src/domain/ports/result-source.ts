/**
 * ResultSource port — abstraction over external match result providers.
 *
 * Concrete adapters: ApiResultSource (Football-Data.org or API-Football)
 *                    ManualResultSource (admin UI)
 *
 * The domain never sees provider-specific shapes or local times.
 * Adapters normalize kickoff and status to UTC + canonical status on ingest.
 *
 * Design decision #1: provider is a deploy dependency, not a code dependency.
 */

export interface MatchResult {
  /** Canonical match ID in our DB. */
  matchId: string;
  /** Goals scored by the home team. */
  homeScore: number;
  /** Goals scored by the away team. */
  awayScore: number;
  /** Normalized status — provider-specific values are mapped to this enum. */
  status: "scheduled" | "in_progress" | "finished";
  /** Who provided this result. */
  source: "auto" | "manual";
}

/**
 * ResultSource port interface.
 * Any provider adapter that implements this is interchangeable.
 */
export interface ResultSource {
  /**
   * Fetch the latest result for a given match.
   * Returns null if the result is not yet available.
   */
  getResult: (matchId: string) => Promise<MatchResult | null>;
}

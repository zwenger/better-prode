/**
 * TournamentSource port — abstraction over tournament structure providers.
 *
 * Provides tournament structure data: teams, fixtures, groups.
 * Distinct from ResultSource (live scores) — fetches tournament data
 * at import time, not per-match.
 *
 * Design decision #1: New TournamentSource port; FifaAdapter implements both
 * TournamentSource and ResultSource. SRP — failover wrappers can target only
 * ResultSource without coupling to structure import.
 *
 * Design decision #2: FIFA IdMatch/IdTeam stored prefixed (fifa-m-/fifa-t-)
 * as domain ids. Deterministic ids enable idempotent import by PK.
 *
 * The domain never sees provider-specific shapes. The adapter is the
 * anti-corruption layer — all FIFA JSON parsing is confined there.
 */

/** Normalized status for a match. */
export type MatchStatus = "scheduled" | "in_progress" | "finished";

/**
 * A team as represented in the domain.
 * code is the ISO 3166-1 alpha-2 country code, null if not yet mapped.
 */
export interface TournamentTeam {
  /** Stable domain id — e.g. "fifa-t-43911". */
  id: string;
  /** Display name — e.g. "Mexico". */
  name: string;
  /** ISO 3166-1 alpha-2 code (e.g. "MX"), or null when not yet mapped. */
  code: string | null;
}

/**
 * A match as represented in the domain.
 */
export interface TournamentMatch {
  /** Stable domain id — e.g. "fifa-m-400021443". */
  id: string;
  /** Domain id of the home team. */
  homeTeamId: string;
  /** Domain id of the away team. */
  awayTeamId: string;
  /** Kickoff timestamp in UTC, ISO 8601. */
  kickoffUtc: string;
  /** Normalized match status. */
  status: MatchStatus;
  /** Home team goals, null if match not yet played. */
  homeScore: number | null;
  /** Away team goals, null if match not yet played. */
  awayScore: number | null;
  /** Group label — e.g. "Group A". */
  group: string;
  /** Stage identifier — e.g. "289273" (FIFA IdStage). */
  stage: string;
}

/**
 * Full tournament structure returned by fetchStructure.
 */
export interface TournamentStructure {
  /** Stable tournament id — e.g. "17-285023" (competitionId-seasonId). */
  tournamentId: string;
  /** Human-readable name — e.g. "FIFA World Cup 2026™". */
  name: string;
  /** All teams participating in this tournament. */
  teams: TournamentTeam[];
  /** All fixtures (past, present, and future). */
  matches: TournamentMatch[];
}

/**
 * TournamentSource port interface.
 * Any provider adapter that implements this is interchangeable.
 */
export interface TournamentSource {
  /**
   * Fetch the full tournament structure for the given competition/season.
   *
   * @param competitionId — Provider competition identifier (e.g. "17" for WC).
   * @param seasonId — Provider season identifier (e.g. "285023" for WC2026).
   */
  fetchStructure: (
    competitionId: string,
    seasonId: string
  ) => Promise<TournamentStructure>;
}

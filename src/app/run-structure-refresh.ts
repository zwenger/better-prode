/**
 * run-structure-refresh — shared core for the structure-refresh trigger path.
 *
 * Fetches the current tournament structure from the source (FIFA) and upserts
 * it idempotently via importTournament. This is what fills in concrete team IDs
 * for knockout matches once the bracket advances — the 5-minute results cron
 * only settles RESULTS of EXISTING matches, it never imports new fixtures.
 *
 * Design notes:
 *   - This path does NOT need the Workers `env` or the MatchDO Durable Object:
 *     structure upserts are plain DB writes and importTournament NEVER touches
 *     result fields (homeScore, awayScore, status, settledAt, resultSource).
 *     So, unlike runIngest, we deliberately do not thread env/MATCH_DO through.
 *   - getDb() reads the libSQL/Turso client from process.env, which is populated
 *     in the scheduled/cron context, so no request scope is required.
 *
 * Tournament ID note:
 *   tournamentId = DB `tournament.id` (e.g. "17-285023" = competitionId-seasonId).
 *   We split on the FIRST `-` only: competition = "17", season = "285023".
 *   Season IDs are opaque provider strings and could in principle contain a
 *   dash, so splitting on the first dash preserves the rest as the season.
 *
 * Exports both:
 *   - runStructureRefresh(tournamentId)        — production entry (wires real infra)
 *   - makeRunStructureRefresh(overrides)        — factory for unit tests (DI)
 */

import type { ImportResult } from "#/adapters/tournament-import/import";
import type { TournamentStructure } from "#/domain/ports/tournament-source";

// ---------------------------------------------------------------------------
// Internal dependency shape (overridable in tests)
// ---------------------------------------------------------------------------

type FetchStructureFn = (
  competitionId: string,
  seasonId: string
) => Promise<TournamentStructure>;

type ImportTournamentFn = (
  structure: TournamentStructure
) => Promise<ImportResult>;

interface RunStructureRefreshOverrides {
  fetchStructure: FetchStructureFn;
  importTournament: ImportTournamentFn;
}

// ---------------------------------------------------------------------------
// tournamentId parsing
// ---------------------------------------------------------------------------

/**
 * Splits a DB tournament.id ("competitionId-seasonId") on the FIRST dash.
 *
 * A malformed id (no dash) is a configuration/data error, not a transient
 * runtime condition. We THROW rather than returning a zero-result: a silent
 * zero-result would mask a misconfigured TOURNAMENT_ID and the cron would
 * appear "healthy" while never refreshing structure. Failing loudly mirrors
 * how getDb() throws on a missing TURSO_DATABASE_URL — surface config errors,
 * don't swallow them.
 */
function splitTournamentId(tournamentId: string): {
  competitionId: string;
  seasonId: string;
} {
  const dashIndex = tournamentId.indexOf("-");
  if (dashIndex === -1) {
    throw new Error(
      `malformed tournamentId "${tournamentId}": expected "competitionId-seasonId"`
    );
  }
  return {
    competitionId: tournamentId.slice(0, dashIndex),
    seasonId: tournamentId.slice(dashIndex + 1),
  };
}

// ---------------------------------------------------------------------------
// makeRunStructureRefresh — DI factory used by unit tests
// ---------------------------------------------------------------------------

/**
 * Creates a runStructureRefresh function with injected deps.
 * Used in unit tests to avoid real DB/FIFA calls. The injected importTournament
 * receives only the structure — the DB binding is the production concern wired
 * inside runStructureRefresh below.
 */
export function makeRunStructureRefresh(
  overrides: RunStructureRefreshOverrides
) {
  return async function runStructureRefreshWithOverrides(
    tournamentId: string
  ): Promise<ImportResult> {
    const { competitionId, seasonId } = splitTournamentId(tournamentId);
    const structure = await overrides.fetchStructure(competitionId, seasonId);
    return overrides.importTournament(structure);
  };
}

// ---------------------------------------------------------------------------
// runStructureRefresh — production entry with real infrastructure
// ---------------------------------------------------------------------------

/**
 * Refresh the stored tournament structure from the source (FIFA).
 *
 * 1. Splits tournamentId into competition + season (on the first dash).
 * 2. Fetches the current structure via FifaAdapter.fetchStructure.
 * 3. Idempotently upserts it via importTournament (NEVER touches result fields).
 * 4. Returns the ImportResult.
 *
 * @param tournamentId DB tournament.id (e.g. "17-285023").
 */
export async function runStructureRefresh(
  tournamentId: string
): Promise<ImportResult> {
  // Lazy imports keep Workers-specific bindings out of module-level imports
  // so this module can be referenced in test environments.
  const [{ getDb }, { FifaAdapter }, { importTournament }] = await Promise.all([
    import("#/infra/db/client"),
    import("#/adapters/result-source/fifa"),
    import("#/adapters/tournament-import/import"),
  ]);

  const { competitionId, seasonId } = splitTournamentId(tournamentId);
  const structure = await new FifaAdapter().fetchStructure(
    competitionId,
    seasonId
  );
  return importTournament(structure, getDb());
}

/**
 * run-ingest — shared core for all result-refresh trigger paths.
 *
 * Builds real infrastructure deps (DB match repo, FIFA adapter, DO settle fn)
 * and delegates to ingestMatchResults after optionally gating on hasActiveWindowMatches.
 *
 * Design decisions (result-refresh design.md):
 *   #1 — extract shared runIngest so cron scheduled() and admin server fn
 *        share identical dep-wiring; env is the only difference.
 *   #2 — dynamic active-window gate: listUnsettled → hasActiveWindowMatches;
 *        only call FIFA when at least one match is in the 24h active window.
 *        The gate is BYPASSED for the manual admin backstop path so it can
 *        settle matches older than 24h (e.g. stuck matches from previous days).
 *
 * Gate behaviour by caller:
 *   - cron scheduled()   → gate ON  (default, no opts)
 *   - /api/refresh       → gate ON  (default, no opts)
 *   - admin ingestResults → gate OFF (skipWindowGate: true) — settles any age
 *
 * Tournament ID note:
 *   tournamentId = DB `tournament.id` (e.g. "17-285023" = competitionId-seasonId).
 *   This is DISTINCT from the FIFA competition/season IDs hardcoded inside
 *   FifaAdapter.getResult (provider config, not domain key).
 *
 * Exports both:
 *   - runIngest(env, tournamentId, opts?)  — production entry (wires real infra)
 *   - makeRunIngest(overrides)             — factory for unit tests (DI)
 */

import type { IngestResultsOutput } from "#/routes/api/admin/-ingest-results";
import { hasActiveWindowMatches } from "./active-window";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunIngestOptions {
  /**
   * When true, bypass the 24h active-window gate and settle any unsettled
   * past match regardless of age. Intended for the manual admin backstop path.
   * Default: false (cron + on-demand stay window-gated).
   */
  skipWindowGate?: boolean;
}

// ---------------------------------------------------------------------------
// Noop output returned when the active-window gate short-circuits
// ---------------------------------------------------------------------------

const NOOP_OUTPUT: IngestResultsOutput = {
  ingested: 0,
  skipped: 0,
  errors: 0,
  details: [],
};

// ---------------------------------------------------------------------------
// Internal dependency shape (overridable in tests)
// ---------------------------------------------------------------------------

type ListUnsettledFn = (tournamentId: string) => Promise<
  Array<{ id: string; status: string; kickoffUtc: string; [k: string]: unknown }>
>;

type IngestMatchResultsFn = (
  input: { tournamentId: string },
  deps: { matchRepository: unknown; resultSource: unknown; doSettle: (cmd: unknown) => Promise<Response> }
) => Promise<IngestResultsOutput>;

interface RunIngestOverrides {
  listUnsettled: ListUnsettledFn;
  ingestMatchResults: IngestMatchResultsFn;
}

// ---------------------------------------------------------------------------
// makeRunIngest — DI factory used by unit tests
// ---------------------------------------------------------------------------

/**
 * Creates a runIngest function with injected deps.
 * Used in unit tests to avoid real DB/FIFA calls.
 */
export function makeRunIngest(overrides: RunIngestOverrides) {
  return async function runIngestWithOverrides(
    env: { MATCH_DO: DurableObjectNamespace },
    tournamentId: string,
    opts: RunIngestOptions = {}
  ): Promise<IngestResultsOutput> {
    const matches = await overrides.listUnsettled(tournamentId);

    if (!opts.skipWindowGate) {
      const now = new Date();
      if (!hasActiveWindowMatches(matches, now)) {
        return NOOP_OUTPUT;
      }
    }

    const doSettle = (command: unknown): Promise<Response> => {
      const cmd = command as { matchId: string };
      const doId = env.MATCH_DO.idFromName(cmd.matchId);
      const stub = env.MATCH_DO.get(doId);
      return stub.fetch("http://do/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
    };

    return overrides.ingestMatchResults(
      { tournamentId },
      {
        matchRepository: { listUnsettled: overrides.listUnsettled },
        resultSource: null,
        doSettle,
      }
    );
  };
}

// ---------------------------------------------------------------------------
// runIngest — production entry with real infrastructure
// ---------------------------------------------------------------------------

/**
 * Reconcile unsettled matches for a tournament.
 *
 * 1. Queries DB for all past unsettled matches (status scheduled|in_progress, kickoff <= now).
 * 2. Unless skipWindowGate is true, gates on hasActiveWindowMatches (24h lookback) —
 *    skips the FIFA call when no match is in the active window.
 *    When skipWindowGate is true (manual admin backstop), proceeds regardless of age.
 * 3. Wires real deps (DB, FifaAdapter, MATCH_DO) and calls ingestMatchResults.
 *
 * @param env          Worker env object (must have MATCH_DO binding).
 * @param tournamentId DB tournament.id (e.g. "17-285023").
 * @param opts         Optional. Pass { skipWindowGate: true } for admin backstop path.
 */
export async function runIngest(
  env: { MATCH_DO: DurableObjectNamespace },
  tournamentId: string,
  opts: RunIngestOptions = {}
): Promise<IngestResultsOutput> {
  // Lazy imports keep Workers-specific bindings out of module-level imports
  // so this module can be referenced in test environments.
  const [
    { getDb },
    { FifaAdapter },
    { ingestMatchResults },
    { match: matchTable },
    { eq, inArray, lte, and },
  ] = await Promise.all([
    import("#/infra/db/client"),
    import("#/adapters/result-source/fifa"),
    import("#/routes/api/admin/-ingest-results"),
    import("#/infra/db/schema"),
    import("drizzle-orm"),
  ]);

  const db = getDb();
  const now = new Date().toISOString();

  // Build a minimal repo for the active-window gate (listUnsettled).
  const listUnsettled = async (tid: string) => {
    const rows = await db
      .select()
      .from(matchTable)
      .where(
        and(
          inArray(matchTable.status, ["scheduled", "in_progress"]),
          eq(matchTable.tournamentId, tid),
          lte(matchTable.kickoffUtc, now)
        )
      );
    return rows.map((row) => ({
      id: row.id,
      tournamentId: row.tournamentId,
      homeTeamId: row.homeTeamId,
      awayTeamId: row.awayTeamId,
      kickoffUtc: row.kickoffUtc,
      status: row.status,
      homeScore: row.homeScore ?? null,
      awayScore: row.awayScore ?? null,
      resultSource: row.resultSource ?? null,
      settledAt: row.settledAt ?? null,
    }));
  };

  const matches = await listUnsettled(tournamentId);

  // Active-window gate — skipped when the manual admin backstop sets skipWindowGate.
  if (!opts.skipWindowGate && !hasActiveWindowMatches(matches, new Date())) {
    return NOOP_OUTPUT;
  }

  // No matches at all (after gate or with skipWindowGate) → nothing to do.
  if (matches.length === 0) {
    return NOOP_OUTPUT;
  }

  const resultSource = new FifaAdapter();

  const doSettle = (command: unknown): Promise<Response> => {
    const cmd = command as { matchId: string };
    const doId = env.MATCH_DO.idFromName(cmd.matchId);
    const stub = env.MATCH_DO.get(doId);
    return stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
  };

  // The matchRepository used by ingestMatchResults must implement listUnsettled.
  // We reuse the already-fetched rows by wrapping in a closure — avoids a second
  // DB round-trip since we just read them for the gate check above.
  const cachedMatches = matches;
  const matchRepository = {
    listUnsettled: async (_tid: string) => cachedMatches,
  };

  return ingestMatchResults(
    { tournamentId },
    { matchRepository, resultSource, doSettle }
  );
}

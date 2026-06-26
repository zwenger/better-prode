/**
 * GET /api/admin/ingest-results
 *
 * Admin backstage route — polls the FIFA ResultSource for all unsettled
 * matches and routes live results through the per-match MATCH_DO.
 *
 * Design (ADR #6): lazy on-demand trigger. All settlement is serialized
 * through the DO's single-flight mutex. Lazy imports in the handler body
 * prevent Workers-specific bindings from loading in non-Workers contexts
 * (e.g. unit tests that import only the pure ingestMatchResults function).
 *
 * The core logic (ingestMatchResults) and its port interfaces are exported
 * here so unit tests can inject fake deps without loading the infra layer.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import type { MatchRecord } from "#/domain/apply-match-result";
import type { MatchResult } from "#/domain/ports/result-source";
import type { SettleCommand } from "#/workers/match-do";

// ---------------------------------------------------------------------------
// Minimal port interfaces for the ingest use-case (dependency injection)
// ---------------------------------------------------------------------------

export interface IngestMatchRepository {
  /** Return matches with status scheduled|in_progress whose kickoff is in the past. */
  listUnsettled: (tournamentId: string) => Promise<MatchRecord[]>;
}

export interface IngestResultSource {
  getResult: (matchId: string) => Promise<MatchResult | null>;
}

export interface IngestDeps {
  matchRepository: IngestMatchRepository;
  resultSource: IngestResultSource;
  /**
   * Send a settle command to the per-match DO.
   * Abstracted so unit tests can assert on the payload without a real DO.
   */
  doSettle: (command: SettleCommand) => Promise<Response>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IngestResultsInput {
  tournamentId: string;
}

export interface IngestResultsOutput {
  ingested: number;
  skipped: number;
  errors: number;
  details: string[];
}

// ---------------------------------------------------------------------------
// Core logic — pure, injectable, tested directly
// ---------------------------------------------------------------------------

/**
 * Ingest live results for all unsettled matches of a tournament.
 *
 * Runs getResult for all unsettled matches concurrently; for each that
 * returns a non-scheduled result, sends a settle command to the DO.
 * Errors are counted but do not abort the batch.
 */
export async function ingestMatchResults(
  input: IngestResultsInput,
  deps: IngestDeps
): Promise<IngestResultsOutput> {
  const { matchRepository, resultSource, doSettle } = deps;

  const matches = await matchRepository.listUnsettled(input.tournamentId);

  let ingested = 0;
  let skipped = 0;
  let errors = 0;
  const details: string[] = [];

  // Fetch all results concurrently.
  const resultPairs = await Promise.all(
    matches.map(async (m) => ({
      match: m,
      result: await resultSource.getResult(m.id),
    }))
  );

  // Process pairs sequentially for clear per-match accounting.
  for (const { match, result } of resultPairs) {
    if (!result || result.status === "scheduled") {
      skipped++;
      details.push(`skip ${match.id}: ${result ? "still scheduled" : "no result"}`);
      continue;
    }

    const command: SettleCommand = {
      matchId: match.id,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      status: result.status,
      source: result.source,
    };

    try {
      const response = await doSettle(command);
      if (response.ok) {
        ingested++;
        details.push(`settled ${match.id}: ${result.homeScore}-${result.awayScore} (${result.status})`);
      } else {
        const text = await response.text();
        errors++;
        details.push(`error ${match.id}: DO returned ${response.status} — ${text}`);
      }
    } catch (err) {
      errors++;
      details.push(`error ${match.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ingested, skipped, errors, details };
}

// ---------------------------------------------------------------------------
// Admin guard helper
// ---------------------------------------------------------------------------

function isAdmin(userId: string): boolean {
  const adminIds = process.env["ADMIN_USER_IDS"] ?? "";
  return adminIds.split(",").map((id) => id.trim()).includes(userId);
}

// ---------------------------------------------------------------------------
// TanStack Start server function — wires real deps
// Workers-specific bindings (cloudflare:workers, auth, DB) are imported
// lazily inside the handler so this module can be imported in unit tests.
// ---------------------------------------------------------------------------

export interface IngestResultsApiInput {
  tournamentId: string;
}

export interface IngestResultsApiOutput {
  success: boolean;
  ingested: number;
  skipped: number;
  errors: number;
  details: string[];
  error?: string;
}

export const ingestResults = createServerFn({ method: "GET" })
  .validator((data: unknown): IngestResultsApiInput => {
    const raw = data as Record<string, unknown>;
    const tid = raw["tournamentId"];
    if (!tid || typeof tid !== "string") {
      throw Object.assign(new Error("tournamentId is required"), { status: 400 });
    }
    return { tournamentId: tid };
  })
  .handler(async ({ data }): Promise<IngestResultsApiOutput> => {
    // Lazy imports keep Workers-specific bindings out of the module-level
    // import graph so unit tests can import ingestMatchResults without error.
    const [{ env }, { auth }] = await Promise.all([
      import("cloudflare:workers"),
      import("#/infra/auth/auth"),
    ]);

    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }
    if (!isAdmin(session.user.id)) {
      throw new Error("Forbidden: admin only");
    }

    // Delegate to the shared runIngest with skipWindowGate=true.
    // The manual admin backstop must settle ANY unsettled past match regardless
    // of age — including matches >6h old that the cron/on-demand paths would NOOP.
    // env source is the only difference vs. the cron path (cloudflare:workers vs. param).
    const { runIngest } = await import("#/app/run-ingest");
    const result = await runIngest(env, data.tournamentId, { skipWindowGate: true });

    return { success: true, ...result };
  });

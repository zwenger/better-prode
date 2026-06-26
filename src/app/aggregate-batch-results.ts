/**
 * aggregateBatchResults — pure reducer over per-match batch outcomes.
 *
 * Framework-free; can be tested without DOM / React context.
 */

export type BatchOutcome = "saved" | "locked" | "error";

export interface PerMatchResult {
  status: BatchOutcome;
  message?: string;
}

export interface BatchSummary {
  saved: number;
  locked: number;
  error: number;
  total: number;
}

/**
 * Aggregates a map of per-match results into a single summary.
 *
 * @param results - Record keyed by matchId, each with a status and optional message.
 * @returns       - Counts of each outcome and the total number of results.
 */
export function aggregateBatchResults(
  results: Record<string, PerMatchResult>
): BatchSummary {
  let saved = 0;
  let locked = 0;
  let error = 0;

  for (const r of Object.values(results)) {
    if (r.status === "saved") saved++;
    else if (r.status === "locked") locked++;
    else error++;
  }

  return { saved, locked, error, total: saved + locked + error };
}

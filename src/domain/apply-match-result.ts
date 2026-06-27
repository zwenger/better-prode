/**
 * applyMatchResult — the single choke point for match result settlement.
 *
 * Design decision #3: all result-writing (auto API, alarm, manual admin)
 * funnel through this one function. It:
 *  1. Loads the current match state
 *  2. Applies idempotency + manual-pin guards
 *  3. Persists result + settledAt
 *  4. Computes and stores points for every prediction on this match
 *
 * Clock is injected (never Date.now() directly) — design decision #2.
 * Depends only on ports (MatchRepository, PredictionRepository) — no infra.
 */

import type { Clock } from "./ports/clock";
import type { LeaderboardCache } from "./ports/leaderboard-cache";
import { score } from "./scoring";

// --- Domain types ---

export type MatchStatus = "scheduled" | "in_progress" | "finished";
export type ResultSource = "auto" | "manual";

export interface MatchRecord {
  id: string;
  tournamentId: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffUtc: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  resultSource: ResultSource | null;
  settledAt: string | null;
}

export interface PredictionRecord {
  id: string;
  userId: string;
  matchId: string;
  homeGoals: number;
  awayGoals: number;
  points: number | null;
}

// --- Port interfaces (minimal, for this domain function) ---

export interface MatchRepository {
  getById: (id: string) => Promise<MatchRecord | null>;
  updateResult: (
    id: string,
    update: Partial<
      Pick<MatchRecord, "homeScore" | "awayScore" | "resultSource" | "settledAt" | "status">
    >
  ) => Promise<void>;
}

export interface PredictionRepository {
  listByMatch: (matchId: string) => Promise<PredictionRecord[]>;
  updatePoints: (predictionId: string, points: number) => Promise<void>;
}

export interface ApplyMatchResultPorts {
  matchRepository: MatchRepository;
  predictionRepository: PredictionRepository;
}

/**
 * Optional cache-invalidation options for applyMatchResult.
 *
 * W-1 fix: when provided, the function invalidates the leaderboard cache
 * for every group affected by the settled tournament.
 *
 * Both fields are required together — provide neither or both.
 * When absent, invalidation is skipped (backward-compatible, safe default).
 */
export interface ApplyMatchResultCacheOptions {
  /** LeaderboardCache port instance to call invalidate() on. */
  cache: LeaderboardCache;
  /**
   * Returns the distinct group IDs whose members have predictions in the
   * given tournament. Used to enumerate which cache keys to evict.
   */
  listGroupIdsByTournament: (tournamentId: string) => Promise<string[]>;
}

// --- Command type ---

export interface ApplyMatchResultCommand {
  matchId: string;
  homeScore: number;
  awayScore: number;
  status: MatchStatus;
  source: ResultSource;
}

/**
 * Apply a match result.
 *
 * Guards:
 *  - Throws if match not found
 *  - No-op if already settled with identical score + same-or-higher-authority source
 *  - Manual pin: auto cannot overwrite a manual result
 *  - Manual can always overwrite (admin correction)
 *
 * On settlement:
 *  - Updates match.homeScore, awayScore, status, resultSource, settledAt
 *  - Computes scoring.score() for each prediction and writes prediction.points
 *  - If cacheOptions is provided, invalidates the leaderboard cache for all
 *    groups whose members have predictions in the settled tournament (W-1 fix).
 *
 * Cache invalidation is best-effort and does NOT affect the return value.
 * Backward-compatible: omitting cacheOptions is safe for existing call sites.
 */
export async function applyMatchResult(
  command: ApplyMatchResultCommand,
  ports: ApplyMatchResultPorts,
  clock: Clock,
  cacheOptions?: ApplyMatchResultCacheOptions
): Promise<void> {
  const { matchRepository, predictionRepository } = ports;

  const match = await matchRepository.getById(command.matchId);
  if (!match) {
    throw new Error(`Match not found: ${command.matchId}`);
  }

  // Idempotency guard: already settled with the same score and same source
  if (
    match.settledAt !== null &&
    match.homeScore === command.homeScore &&
    match.awayScore === command.awayScore &&
    match.resultSource === command.source
  ) {
    return; // no-op
  }

  // Manual-pin guard: auto cannot overwrite an existing manual result
  if (match.resultSource === "manual" && command.source === "auto") {
    return; // auto defers to manual pin
  }

  // Persist result — update status and (for finished) score/settledAt
  if (command.status === "finished") {
    await matchRepository.updateResult(command.matchId, {
      homeScore: command.homeScore,
      awayScore: command.awayScore,
      status: command.status,
      resultSource: command.source,
      settledAt: clock.now().toISOString(),
    });

    // Compute and store final points for every prediction on this match.
    // Only runs on finished — in_progress interim scores must NOT set points.
    const predictions = await predictionRepository.listByMatch(command.matchId);
    for (const prediction of predictions) {
      const points = score(
        { homeGoals: prediction.homeGoals, awayGoals: prediction.awayGoals },
        { homeGoals: command.homeScore, awayGoals: command.awayScore }
      );
      await predictionRepository.updatePoints(prediction.id, points);
    }

    // W-1 fix: invalidate leaderboard cache for all groups affected by this
    // tournament's settlement. Points have been written above — any cached
    // leaderboard for these groups is now stale.
    // Best-effort: a cache failure must not prevent settlement from completing.
    if (cacheOptions) {
      try {
        const { cache, listGroupIdsByTournament } = cacheOptions;
        const groupIds = await listGroupIdsByTournament(match.tournamentId);
        await Promise.all(
          groupIds.map((groupId) => cache.invalidate(groupId, match.tournamentId))
        );
      } catch {
        // Cache invalidation failure is non-fatal — the settlement already succeeded.
        // Stale cache will expire via TTL (max 300s).
      }
    }
  } else {
    // in_progress (or scheduled): update status + live score — drives the
    // bet-lock AND lets the "En vivo" pill show the running score.
    // No settledAt, no points — the match is not yet final.
    await matchRepository.updateResult(command.matchId, {
      homeScore: command.homeScore,
      awayScore: command.awayScore,
      status: command.status,
    });
  }
}

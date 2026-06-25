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
 */
export async function applyMatchResult(
  command: ApplyMatchResultCommand,
  ports: ApplyMatchResultPorts,
  clock: Clock
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
  } else {
    // in_progress (or scheduled): update status only — drives the bet-lock.
    // No settledAt, no points — the match is not yet final.
    await matchRepository.updateResult(command.matchId, {
      status: command.status,
    });
  }
}

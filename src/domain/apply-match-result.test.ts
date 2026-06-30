import { describe, it, expect, beforeEach } from "vitest";
import {
  applyMatchResult



} from "./apply-match-result";
import type {MatchRecord, PredictionRecord, ApplyMatchResultPorts} from "./apply-match-result";
import { FakeClock } from "./ports/clock";
import type { LeaderboardCache } from "./ports/leaderboard-cache";

/**
 * TDD: applyMatchResult choke point tests (task 1.5 RED → 1.6 GREEN)
 *
 * Spec (result-triggering):
 *  - Single choke point — all result-writing goes through here
 *  - Idempotent: same args (same score + same source) → no-op (no re-settle)
 *  - Manual pins: once source=manual is set, auto source cannot overwrite
 *  - Re-settle on changed score (same source, different score → recompute)
 *  - Computes and stores points for every prediction on the match
 *
 * This tests the pure domain logic — ports are in-memory stubs.
 */

const NOW = new Date("2026-06-15T20:00:00.000Z"); // 2h after kickoff

// --- In-memory test doubles (stubs) for ports ---

function makeMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: "match-1",
    tournamentId: "tournament-1",
    homeTeamId: "team-a",
    awayTeamId: "team-b",
    kickoffUtc: "2026-06-15T18:00:00.000Z",
    status: "finished",
    homeScore: null,
    awayScore: null,
    resultSource: null,
    settledAt: null,
    homePenaltyScore: null,
    awayPenaltyScore: null,
    winnerTeamId: null,
    ...overrides,
  };
}

function makePrediction(
  overrides: Partial<PredictionRecord> = {}
): PredictionRecord {
  return {
    id: "pred-1",
    userId: "user-1",
    matchId: "match-1",
    homeGoals: 1,
    awayGoals: 0,
    points: null,
    ...overrides,
  };
}

function makePorts(
  match: MatchRecord,
  predictions: PredictionRecord[]
): ApplyMatchResultPorts & { savedMatch: MatchRecord | null; savedPredictions: PredictionRecord[] } {
  const savedPredictions: PredictionRecord[] = [];
  let savedMatch: MatchRecord | null = null;

  return {
    matchRepository: {
      getById: async (id: string) => (id === match.id ? { ...match } : null),
      updateResult: async (_id, update) => {
        match = { ...match, ...update };
        savedMatch = { ...match };
      },
    },
    predictionRepository: {
      listByMatch: async (matchId: string) =>
        matchId === match.id ? [...predictions] : [],
      updatePoints: async (predId, points) => {
        const pred = predictions.find((p) => p.id === predId);
        if (pred) {
          pred.points = points;
          savedPredictions.push({ ...pred });
        }
      },
    },
    get savedMatch() {
      return savedMatch;
    },
    get savedPredictions() {
      return savedPredictions;
    },
  };
}

describe("applyMatchResult", () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = new FakeClock(NOW);
  });

  it("computes and stores points for each prediction", async () => {
    const match = makeMatch({ status: "finished" });
    const predictions = [
      makePrediction({ homeGoals: 2, awayGoals: 1 }), // pleno → 7
      makePrediction({ id: "pred-2", userId: "user-2", homeGoals: 2, awayGoals: 0 }), // home win correct, exact home → 4
    ];
    const ports = makePorts(match, predictions);

    await applyMatchResult(
      { matchId: "match-1", homeScore: 2, awayScore: 1, status: "finished", source: "auto" },
      ports,
      clock
    );

    expect(predictions[0].points).toBe(7); // pleno
    expect(predictions[1].points).toBe(4); // outcome(home win)+exact home goals (2=2)
  });

  it("sets match.settledAt and stores result on first settlement", async () => {
    const match = makeMatch({ status: "finished" });
    const ports = makePorts(match, []);

    await applyMatchResult(
      { matchId: "match-1", homeScore: 3, awayScore: 2, status: "finished", source: "auto" },
      ports,
      clock
    );

    expect(ports.savedMatch?.homeScore).toBe(3);
    expect(ports.savedMatch?.awayScore).toBe(2);
    expect(ports.savedMatch?.settledAt).toBe(NOW.toISOString());
    expect(ports.savedMatch?.resultSource).toBe("auto");
  });

  it("idempotent — same score + same source → no-op (does not call updateResult again)", async () => {
    // Already settled with same result
    const match = makeMatch({
      status: "finished",
      homeScore: 1,
      awayScore: 0,
      resultSource: "auto",
      settledAt: "2026-06-15T19:00:00.000Z",
    });
    let updateCallCount = 0;
    const ports = {
      matchRepository: {
        getById: async (_id: string) => ({ ...match }),
        updateResult: async (_id: string, _update: Partial<MatchRecord>) => {
          updateCallCount++;
        },
      },
      predictionRepository: {
        listByMatch: async (_matchId: string) => [],
        updatePoints: async (_predId: string, _points: number) => {},
      },
    };

    await applyMatchResult(
      { matchId: "match-1", homeScore: 1, awayScore: 0, status: "finished", source: "auto" },
      ports,
      clock
    );

    expect(updateCallCount).toBe(0);
  });

  it("manual pins — auto source cannot overwrite a manual result", async () => {
    const match = makeMatch({
      status: "finished",
      homeScore: 2,
      awayScore: 1,
      resultSource: "manual",
      settledAt: "2026-06-15T19:00:00.000Z",
    });
    let updateCallCount = 0;
    const ports = {
      matchRepository: {
        getById: async (_id: string) => ({ ...match }),
        updateResult: async (_id: string, _update: Partial<MatchRecord>) => {
          updateCallCount++;
        },
      },
      predictionRepository: {
        listByMatch: async (_matchId: string) => [],
        updatePoints: async (_predId: string, _points: number) => {},
      },
    };

    // auto tries to overwrite manual with a different score
    await applyMatchResult(
      { matchId: "match-1", homeScore: 0, awayScore: 0, status: "finished", source: "auto" },
      ports,
      clock
    );

    expect(updateCallCount).toBe(0);
  });

  it("manual can overwrite a previous manual (admin correction)", async () => {
    const match = makeMatch({
      status: "finished",
      homeScore: 1,
      awayScore: 0,
      resultSource: "manual",
      settledAt: "2026-06-15T19:00:00.000Z",
    });
    const predictions = [makePrediction({ homeGoals: 2, awayGoals: 1 })];
    const ports = makePorts(match, predictions);

    // manual corrects to 2-1 → pred was 2-1 → pleno → 7
    await applyMatchResult(
      { matchId: "match-1", homeScore: 2, awayScore: 1, status: "finished", source: "manual" },
      ports,
      clock
    );

    expect(ports.savedMatch?.homeScore).toBe(2);
    expect(predictions[0].points).toBe(7);
  });

  it("auto can update score when no manual pin exists (re-settle on changed result)", async () => {
    const match = makeMatch({
      status: "finished",
      homeScore: 1,
      awayScore: 0,
      resultSource: "auto",
      settledAt: "2026-06-15T19:00:00.000Z",
    });
    const predictions = [makePrediction({ homeGoals: 0, awayGoals: 0 })]; // draw pred
    const ports = makePorts(match, predictions);

    // score changes from 1-0 to 0-0 (correction from auto source)
    await applyMatchResult(
      { matchId: "match-1", homeScore: 0, awayScore: 0, status: "finished", source: "auto" },
      ports,
      clock
    );

    // pred was 0-0, result is now 0-0 → pleno → 7
    expect(predictions[0].points).toBe(7);
  });

  it("throws if match is not found", async () => {
    const ports = {
      matchRepository: {
        getById: async (_id: string) => null,
        updateResult: async (_id: string, _update: Partial<MatchRecord>) => {},
      },
      predictionRepository: {
        listByMatch: async (_matchId: string) => [],
        updatePoints: async (_predId: string, _points: number) => {},
      },
    };

    await expect(
      applyMatchResult(
        { matchId: "missing-match", homeScore: 1, awayScore: 0, status: "finished", source: "auto" },
        ports,
        clock
      )
    ).rejects.toThrow("Match not found: missing-match");
  });
});

// ---------------------------------------------------------------------------
// Penalty shootout threading + SCORING ISOLATION
//
// CRITICAL: penalty fields must NEVER reach score().
// score() must be called with only {homeGoals: homeScore, awayGoals: awayScore}.
// ---------------------------------------------------------------------------

describe("applyMatchResult — penalty shootout threading", () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = new FakeClock(NOW);
  });

  it("persists penalty fields when present on a finished match", async () => {
    const match = makeMatch({ status: "finished" });
    const ports = makePorts(match, []);

    await applyMatchResult(
      {
        matchId: "match-1",
        homeScore: 1,
        awayScore: 1,
        status: "finished",
        source: "auto",
        homePenaltyScore: 4,
        awayPenaltyScore: 2,
        winnerTeamId: "fifa-t-43911",
      },
      ports,
      clock
    );

    expect(ports.savedMatch?.homePenaltyScore).toBe(4);
    expect(ports.savedMatch?.awayPenaltyScore).toBe(2);
    expect(ports.savedMatch?.winnerTeamId).toBe("fifa-t-43911");
    // Regulation score unchanged
    expect(ports.savedMatch?.homeScore).toBe(1);
    expect(ports.savedMatch?.awayScore).toBe(1);
  });

  it("scoring isolation — score() uses only regulation goals (not penalty scores)", async () => {
    // Penalty match: 1-1 at regulation, home wins 4-2 on penalties.
    // The prediction is 1-1 → pleno (7 pts) based on REGULATION only.
    // If penalty scores leaked into score(), the result would be 4-2 → no pleno.
    const match = makeMatch({ status: "finished" });
    const predictions = [makePrediction({ homeGoals: 1, awayGoals: 1 })]; // 1-1 prediction
    const ports = makePorts(match, predictions);

    await applyMatchResult(
      {
        matchId: "match-1",
        homeScore: 1,    // regulation: 1-1 (draw)
        awayScore: 1,
        status: "finished",
        source: "auto",
        homePenaltyScore: 4,  // penalty: 4-2 home wins
        awayPenaltyScore: 2,
        winnerTeamId: "fifa-t-43911",
      },
      ports,
      clock
    );

    // The prediction was 1-1, the regulation result is 1-1 → pleno → 7 pts
    // If penalty (4-2) had been passed to score(), points would be 0 (wrong exact goals, correct outcome)
    expect(predictions[0].points).toBe(7); // PLENO — proves penalty fields did NOT reach score()
  });

  it("penalty fields are null when not provided (non-penalty match, backward compat)", async () => {
    const match = makeMatch({ status: "finished" });
    const ports = makePorts(match, []);

    await applyMatchResult(
      { matchId: "match-1", homeScore: 2, awayScore: 0, status: "finished", source: "auto" },
      ports,
      clock
    );

    expect(ports.savedMatch?.homePenaltyScore).toBeNull();
    expect(ports.savedMatch?.awayPenaltyScore).toBeNull();
    expect(ports.savedMatch?.winnerTeamId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation tests (W-1 fix)
//
// Spec (leaderboard): "The cache MUST be invalidated whenever applyMatchResult
// completes and writes new point values."
//
// Design: applyMatchResult accepts an optional LeaderboardCache + a function to
// enumerate affected groupIds. On a finishing settlement, it calls
// cache.invalidate(groupId, tournamentId) for each affected group.
// Idempotent no-ops must NOT trigger invalidation.
// ---------------------------------------------------------------------------

function makeFakeCache(): LeaderboardCache & {
  invalidateCalls: Array<{ groupId: string; tournamentId: string }>;
} {
  const invalidateCalls: Array<{ groupId: string; tournamentId: string }> = [];
  return {
    invalidateCalls,
    async get() { return null; },
    async set() {},
    async invalidate(groupId: string, tournamentId: string) {
      invalidateCalls.push({ groupId, tournamentId });
    },
  };
}

describe("applyMatchResult — cache invalidation (W-1)", () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = new FakeClock(NOW);
  });

  it("calls cache.invalidate for each affected group on a finishing settlement", async () => {
    const match = makeMatch({ status: "finished" });
    const ports = makePorts(match, []);
    const cache = makeFakeCache();
    const groupIds = ["group-1", "group-2"];

    await applyMatchResult(
      { matchId: "match-1", homeScore: 2, awayScore: 1, status: "finished", source: "auto" },
      ports,
      clock,
      { cache, listGroupIdsByTournament: async (_tid: string) => groupIds }
    );

    expect(cache.invalidateCalls).toHaveLength(2);
    expect(cache.invalidateCalls).toContainEqual({ groupId: "group-1", tournamentId: "tournament-1" });
    expect(cache.invalidateCalls).toContainEqual({ groupId: "group-2", tournamentId: "tournament-1" });
  });

  it("does NOT call cache.invalidate on an idempotent no-op (same score + source)", async () => {
    // Already settled with identical result
    const match = makeMatch({
      status: "finished",
      homeScore: 1,
      awayScore: 0,
      resultSource: "auto",
      settledAt: "2026-06-15T19:00:00.000Z",
    });
    const ports = {
      matchRepository: {
        getById: async (_id: string) => ({ ...match }),
        updateResult: async (_id: string, _update: Partial<MatchRecord>) => {},
      },
      predictionRepository: {
        listByMatch: async (_matchId: string) => [],
        updatePoints: async (_predId: string, _points: number) => {},
      },
    };
    const cache = makeFakeCache();

    await applyMatchResult(
      { matchId: "match-1", homeScore: 1, awayScore: 0, status: "finished", source: "auto" },
      ports,
      clock,
      { cache, listGroupIdsByTournament: async (_tid: string) => ["group-1"] }
    );

    expect(cache.invalidateCalls).toHaveLength(0);
  });

  it("does NOT call cache.invalidate on a manual-pin no-op (auto blocked)", async () => {
    const match = makeMatch({
      status: "finished",
      homeScore: 2,
      awayScore: 1,
      resultSource: "manual",
      settledAt: "2026-06-15T19:00:00.000Z",
    });
    const ports = {
      matchRepository: {
        getById: async (_id: string) => ({ ...match }),
        updateResult: async (_id: string, _update: Partial<MatchRecord>) => {},
      },
      predictionRepository: {
        listByMatch: async (_matchId: string) => [],
        updatePoints: async (_predId: string, _points: number) => {},
      },
    };
    const cache = makeFakeCache();

    await applyMatchResult(
      { matchId: "match-1", homeScore: 0, awayScore: 0, status: "finished", source: "auto" },
      ports,
      clock,
      { cache, listGroupIdsByTournament: async (_tid: string) => ["group-1"] }
    );

    expect(cache.invalidateCalls).toHaveLength(0);
  });

  it("does NOT call cache.invalidate for non-finished status updates (in_progress)", async () => {
    const match = makeMatch({ status: "scheduled" });
    const ports = makePorts(match, []);
    const cache = makeFakeCache();

    await applyMatchResult(
      { matchId: "match-1", homeScore: 1, awayScore: 0, status: "in_progress", source: "auto" },
      ports,
      clock,
      { cache, listGroupIdsByTournament: async (_tid: string) => ["group-1"] }
    );

    expect(cache.invalidateCalls).toHaveLength(0);
  });

  it("in_progress updates the live score + status, but NOT settledAt or points", async () => {
    // Live pill ("En vivo") must show the running score, so an in_progress
    // update writes homeScore/awayScore. It must NOT settle (no settledAt) and
    // must NOT compute points (the match is not final yet).
    const match = makeMatch({ status: "scheduled", homeScore: null, awayScore: null });
    const predictions = [makePrediction({ homeGoals: 1, awayGoals: 0 })];
    const ports = makePorts(match, predictions);

    await applyMatchResult(
      { matchId: "match-1", homeScore: 2, awayScore: 1, status: "in_progress", source: "auto" },
      ports,
      clock
    );

    expect(ports.savedMatch).not.toBeNull();
    expect(ports.savedMatch!.status).toBe("in_progress");
    expect(ports.savedMatch!.homeScore).toBe(2);
    expect(ports.savedMatch!.awayScore).toBe(1);
    expect(ports.savedMatch!.settledAt).toBeNull();
    // No points written while the match is still live.
    expect(ports.savedPredictions).toHaveLength(0);
  });

  it("works with no cache options provided (backward compatible — no error)", async () => {
    const match = makeMatch({ status: "finished" });
    const ports = makePorts(match, []);

    // No cache argument — existing callers without cache still work
    await expect(
      applyMatchResult(
        { matchId: "match-1", homeScore: 2, awayScore: 1, status: "finished", source: "auto" },
        ports,
        clock
      )
    ).resolves.not.toThrow();
  });
});

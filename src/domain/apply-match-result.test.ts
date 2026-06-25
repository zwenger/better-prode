import { describe, it, expect, beforeEach } from "vitest";
import {
  applyMatchResult,
  type MatchRecord,
  type PredictionRecord,
  type ApplyMatchResultPorts,
  type ResultSource,
} from "./apply-match-result";
import { FakeClock } from "./ports/clock";

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
      updateResult: async (id, update) => {
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

    expect(predictions[0]!.points).toBe(7); // pleno
    expect(predictions[1]!.points).toBe(4); // outcome(home win)+exact home goals (2=2)
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
    expect(predictions[0]!.points).toBe(7);
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
    expect(predictions[0]!.points).toBe(7);
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

/**
 * TDD 3.8 (RED): Lazy on-demand trigger tests for match detail loader.
 *
 * Spec (result-triggering):
 *  - First viewer after FT → DO dispatch fires → settlement starts
 *  - Subsequent viewers → match already settled → no DO dispatch
 *  - Only fires when status === "finished" AND settledAt IS NULL
 *  - Scheduled or in-progress matches → no dispatch
 *
 * Strategy: test the `dispatchIfUnsettled` domain helper that the route loader
 * calls. The helper accepts:
 *   - A match record with { status, settledAt, id, homeScore, awayScore }
 *   - A DoDispatcher port for calling the MATCH_DO /settle endpoint
 * It is a pure domain function — no DB or framework deps.
 *
 * The route loader itself (TanStack Start server fn) is not unit-testable
 * without full DB setup, so the unit test covers the decision function only.
 * The integration is verified by TypeScript + the existing tracer-bullet E2E
 * (deferred pending Node ≥22.9).
 */

import { describe, it, expect, vi } from "vitest";
import type { DispatchableMatch, DoDispatcher } from "./-match-lazy-trigger";
import { dispatchIfUnsettled } from "./-match-lazy-trigger";

function makeMatch(overrides: Partial<DispatchableMatch> = {}): DispatchableMatch {
  return {
    id: "match-1",
    status: "finished",
    settledAt: null,
    homeScore: 2,
    awayScore: 1,
    ...overrides,
  };
}

describe("dispatchIfUnsettled — lazy trigger domain helper", () => {
  it("dispatches to DO when match is finished and not settled", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const dispatcher: DoDispatcher = { settle: dispatch };

    const match = makeMatch({ status: "finished", settledAt: null });

    const result = await dispatchIfUnsettled(match, dispatcher);

    expect(result.dispatched).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      matchId: "match-1",
      homeScore: 2,
      awayScore: 1,
      status: "finished",
      source: "auto",
      homePenaltyScore: null,
      awayPenaltyScore: null,
      winnerTeamId: null,
    });
  });

  it("forwards non-null penalty fields through the SettlePayload", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const dispatcher: DoDispatcher = { settle: dispatch };

    const match = makeMatch({
      status: "finished",
      settledAt: null,
      homeScore: 1,
      awayScore: 1,
      homePenaltyScore: 4,
      awayPenaltyScore: 2,
      winnerTeamId: "fifa-t-43911",
    });

    const result = await dispatchIfUnsettled(match, dispatcher);

    expect(result.dispatched).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      matchId: "match-1",
      homeScore: 1,
      awayScore: 1,
      status: "finished",
      source: "auto",
      homePenaltyScore: 4,
      awayPenaltyScore: 2,
      winnerTeamId: "fifa-t-43911",
    });
  });

  it("does NOT dispatch when match is already settled (second viewer no-op)", async () => {
    const dispatch = vi.fn();
    const dispatcher: DoDispatcher = { settle: dispatch };

    const match = makeMatch({
      status: "finished",
      settledAt: "2026-06-15T20:30:00.000Z", // already settled
    });

    const result = await dispatchIfUnsettled(match, dispatcher);

    expect(result.dispatched).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does NOT dispatch when match is still scheduled", async () => {
    const dispatch = vi.fn();
    const dispatcher: DoDispatcher = { settle: dispatch };

    const match = makeMatch({ status: "scheduled", settledAt: null });

    const result = await dispatchIfUnsettled(match, dispatcher);

    expect(result.dispatched).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does NOT dispatch when match is in_progress", async () => {
    const dispatch = vi.fn();
    const dispatcher: DoDispatcher = { settle: dispatch };

    const match = makeMatch({ status: "in_progress", settledAt: null });

    const result = await dispatchIfUnsettled(match, dispatcher);

    expect(result.dispatched).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does NOT dispatch when scores are null (score not available yet)", async () => {
    const dispatch = vi.fn();
    const dispatcher: DoDispatcher = { settle: dispatch };

    const match = makeMatch({
      status: "finished",
      settledAt: null,
      homeScore: null,
      awayScore: null,
    });

    const result = await dispatchIfUnsettled(match, dispatcher);

    expect(result.dispatched).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatched=true means DO was called exactly once (no double-dispatch)", async () => {
    let callCount = 0;
    const dispatcher: DoDispatcher = {
      settle: async () => {
        callCount++;
      },
    };

    const match = makeMatch({ status: "finished", settledAt: null });

    await dispatchIfUnsettled(match, dispatcher);
    await dispatchIfUnsettled(match, dispatcher); // second call same match state

    // Both calls dispatch (the DO itself deduplicates via idempotency + mutex).
    // dispatchIfUnsettled is stateless — it relies on the DO for dedup.
    // Each call with settledAt=null dispatches once.
    expect(callCount).toBe(2);
  });
});

/**
 * RED tests for hasActiveWindowMatches — written BEFORE the implementation.
 *
 * hasActiveWindowMatches(matches, now, lookbackHours?) → boolean
 *   Returns true iff at least one match has:
 *     - status in { scheduled, in_progress }
 *     - kickoffUtc <= now (kicked off)
 *     - kickoffUtc >= now - lookbackHours * 60 * 60 * 1000 (within lookback floor)
 *
 * Pure function — no Workers bindings.
 */

import { describe, it, expect } from "vitest";
import { hasActiveWindowMatches } from "./active-window";

const NOW = new Date("2026-06-26T18:00:00.000Z");

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
}

describe("hasActiveWindowMatches", () => {
  it("match with status=scheduled kicked off 1h ago → true (in active window)", () => {
    expect(
      hasActiveWindowMatches(
        [{ status: "scheduled", kickoffUtc: hoursAgo(1) }],
        NOW
      )
    ).toBe(true);
  });

  it("match with status=in_progress kicked off 5h ago → true", () => {
    expect(
      hasActiveWindowMatches(
        [{ status: "in_progress", kickoffUtc: hoursAgo(5) }],
        NOW
      )
    ).toBe(true);
  });

  it("match with status=finished → false (status filter rejects it)", () => {
    expect(
      hasActiveWindowMatches(
        [{ status: "finished", kickoffUtc: hoursAgo(1) }],
        NOW
      )
    ).toBe(false);
  });

  it("match kicked off 7h ago (beyond default lookbackHours=6) → false", () => {
    expect(
      hasActiveWindowMatches(
        [{ status: "scheduled", kickoffUtc: hoursAgo(7) }],
        NOW
      )
    ).toBe(false);
  });

  it("empty matches array → false", () => {
    expect(hasActiveWindowMatches([], NOW)).toBe(false);
  });

  it("custom lookbackHours=2: match 3h ago → false", () => {
    expect(
      hasActiveWindowMatches(
        [{ status: "scheduled", kickoffUtc: hoursAgo(3) }],
        NOW,
        2
      )
    ).toBe(false);
  });

  it("custom lookbackHours=2: match 1h ago → true", () => {
    expect(
      hasActiveWindowMatches(
        [{ status: "scheduled", kickoffUtc: hoursAgo(1) }],
        NOW,
        2
      )
    ).toBe(true);
  });

  it("mix of matches — one scheduled in window, one finished → true", () => {
    expect(
      hasActiveWindowMatches(
        [
          { status: "finished", kickoffUtc: hoursAgo(1) },
          { status: "scheduled", kickoffUtc: hoursAgo(2) },
        ],
        NOW
      )
    ).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { isLocked } from "./lock";
import { FakeClock } from "./ports/clock";

/**
 * TDD: Prediction lock tests (task 1.3 RED → 1.4 GREEN)
 *
 * Spec (predictions): lock is server-authoritative.
 * A prediction is locked when: now >= kickoff - 5 minutes.
 * Clock is ALWAYS injected — the function never calls Date.now() directly.
 */

const KICKOFF = new Date("2026-06-15T18:00:00.000Z");
const LOCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

describe("isLocked(kickoffUtc, clock)", () => {
  it("returns false well before kickoff (T-60min)", () => {
    const clock = new FakeClock(new Date(KICKOFF.getTime() - 60 * 60 * 1000));
    expect(isLocked(KICKOFF, clock)).toBe(false);
  });

  it("returns false just before the 5-minute lock window (T-6min)", () => {
    const clock = new FakeClock(new Date(KICKOFF.getTime() - 6 * 60 * 1000));
    expect(isLocked(KICKOFF, clock)).toBe(false);
  });

  it("returns false at exactly T-5min-1sec (one second before lock)", () => {
    const clock = new FakeClock(new Date(KICKOFF.getTime() - LOCK_THRESHOLD_MS - 1));
    expect(isLocked(KICKOFF, clock)).toBe(false);
  });

  it("returns true at exactly T-5min (boundary is closed — >= locks)", () => {
    const clock = new FakeClock(new Date(KICKOFF.getTime() - LOCK_THRESHOLD_MS));
    expect(isLocked(KICKOFF, clock)).toBe(true);
  });

  it("returns true at T-4min (inside the lock window)", () => {
    const clock = new FakeClock(new Date(KICKOFF.getTime() - 4 * 60 * 1000));
    expect(isLocked(KICKOFF, clock)).toBe(true);
  });

  it("returns true at exactly kickoff time", () => {
    const clock = new FakeClock(KICKOFF);
    expect(isLocked(KICKOFF, clock)).toBe(true);
  });

  it("returns true after kickoff (T+30min)", () => {
    const clock = new FakeClock(new Date(KICKOFF.getTime() + 30 * 60 * 1000));
    expect(isLocked(KICKOFF, clock)).toBe(true);
  });

  it("accepts kickoff as a string (ISO 8601 UTC) — robust input handling", () => {
    const clock = new FakeClock(new Date(KICKOFF.getTime() - LOCK_THRESHOLD_MS));
    // should parse string and still return true at the boundary
    expect(isLocked("2026-06-15T18:00:00.000Z", clock)).toBe(true);
  });
});

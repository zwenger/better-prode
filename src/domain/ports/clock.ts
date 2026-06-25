/**
 * Clock PORT — hexagonal architecture boundary.
 *
 * The domain NEVER calls `Date.now()` or `new Date()` directly.
 * All time-sensitive logic (lock check, alarm scheduling) receives a Clock
 * so tests can control time deterministically without sleeps or mocks.
 *
 * Design decision #2: Injectable Clock port (see design.md).
 * Zero infrastructure dependencies — pure TypeScript interface + implementations.
 */

/**
 * The Clock port interface. Domain code depends only on this shape.
 */
export interface Clock {
  /** Returns the current time as a Date (always in UTC, always a new instance). */
  now(): Date;
}

/**
 * SystemClock — production implementation.
 * Uses `Date.now()` under the hood and wraps in a Date for a consistent
 * return type. Returns a new Date instance on each call.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * FakeClock — test utility.
 * Initialized with a fixed time; supports `advanceBy` and `setTime`
 * to exercise time-sensitive domain logic without real waiting.
 *
 * Usage:
 *   const clock = new FakeClock(new Date("2026-06-15T18:00:00Z"));
 *   clock.advanceBy(5 * 60 * 1000); // move 5 minutes forward
 *   isLocked(match, clock);          // deterministic
 */
export class FakeClock implements Clock {
  private currentTime: number;

  constructor(initialTime: Date) {
    this.currentTime = initialTime.getTime();
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  /**
   * Advances the clock by the given number of milliseconds.
   * Cumulative — multiple calls add up.
   */
  advanceBy(ms: number): void {
    this.currentTime += ms;
  }

  /**
   * Sets the clock to a specific point in time.
   * Useful for jumping to a known timestamp in tests.
   */
  setTime(time: Date): void {
    this.currentTime = time.getTime();
  }
}

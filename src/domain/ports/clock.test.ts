import { describe, it, expect, beforeEach } from "vitest";
import { SystemClock, FakeClock } from "./clock";

/**
 * TDD: Clock port tests (task 0.12)
 * Written BEFORE implementation — these reference SystemClock and FakeClock
 * which do not exist yet, ensuring RED.
 */

describe("SystemClock", () => {
  it("returns the current time as a Date", () => {
    const clock = new SystemClock();
    const before = Date.now();
    const now = clock.now();
    const after = Date.now();

    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it("returns a new Date object on each call (not the same reference)", () => {
    const clock = new SystemClock();
    const t1 = clock.now();
    const t2 = clock.now();
    // Should be distinct instances
    expect(t1).not.toBe(t2);
    // But both should be valid dates close in time
    expect(t2.getTime()).toBeGreaterThanOrEqual(t1.getTime());
  });
});

describe("FakeClock", () => {
  let fakeClock: FakeClock;
  const FIXED_TIME = new Date("2026-06-15T18:00:00.000Z");

  beforeEach(() => {
    fakeClock = new FakeClock(FIXED_TIME);
  });

  it("returns the time it was initialized with", () => {
    const result = fakeClock.now();
    expect(result).toEqual(FIXED_TIME);
  });

  it("returns a new Date object (not the same reference as the seed)", () => {
    const result = fakeClock.now();
    expect(result).not.toBe(FIXED_TIME);
    expect(result.getTime()).toBe(FIXED_TIME.getTime());
  });

  it("advances time when advanceBy is called", () => {
    const fiveMinutesMs = 5 * 60 * 1000;
    fakeClock.advanceBy(fiveMinutesMs);

    const result = fakeClock.now();
    expect(result.getTime()).toBe(FIXED_TIME.getTime() + fiveMinutesMs);
  });

  it("can advance time multiple times cumulatively", () => {
    fakeClock.advanceBy(1000); // 1 second
    fakeClock.advanceBy(2000); // 2 more seconds

    const result = fakeClock.now();
    expect(result.getTime()).toBe(FIXED_TIME.getTime() + 3000);
  });

  it("setTime replaces the current time", () => {
    const newTime = new Date("2026-06-25T20:00:00.000Z");
    fakeClock.setTime(newTime);

    const result = fakeClock.now();
    expect(result.getTime()).toBe(newTime.getTime());
  });

  it("satisfies the Clock interface (structural check via assignment)", () => {
    // This line proves FakeClock is assignable to Clock at compile time.
    // If Clock interface changes, this test fails to compile.
    const clock: import("./clock").Clock = fakeClock;
    expect(clock.now()).toBeInstanceOf(Date);
  });

  it("SystemClock satisfies the Clock interface (structural check)", () => {
    const systemClock = new SystemClock();
    const clock: import("./clock").Clock = systemClock;
    expect(clock.now()).toBeInstanceOf(Date);
  });
});

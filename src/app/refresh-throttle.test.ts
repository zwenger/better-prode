/**
 * RED tests for shouldThrottle and throttleKey — written BEFORE implementation.
 *
 * shouldThrottle(existing: string | null) → boolean
 *   Returns true iff the KV value indicates an active throttle window.
 *   A non-null, non-empty string means a throttle key was found → skip.
 *
 * throttleKey(tournamentId: string) → string
 *   Builds the KV key for the throttle entry.
 *
 * Pure functions — no Workers bindings.
 */

import { describe, it, expect } from "vitest";
import { shouldThrottle, throttleKey } from "./refresh-throttle";

describe("shouldThrottle", () => {
  it("null → false (no throttle key present)", () => {
    expect(shouldThrottle(null)).toBe(false);
  });

  it('"1" → true (throttle key present)', () => {
    expect(shouldThrottle("1")).toBe(true);
  });

  it('"" → false (empty string is treated as absent)', () => {
    expect(shouldThrottle("")).toBe(false);
  });

  it("any non-empty string → true", () => {
    expect(shouldThrottle("active")).toBe(true);
  });
});

describe("throttleKey", () => {
  it('throttleKey("17-285023") → "refresh:throttle:17-285023"', () => {
    expect(throttleKey("17-285023")).toBe("refresh:throttle:17-285023");
  });

  it("throttleKey with other tournament id", () => {
    expect(throttleKey("1-999")).toBe("refresh:throttle:1-999");
  });
});

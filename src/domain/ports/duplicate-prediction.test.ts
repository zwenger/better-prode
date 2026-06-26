/**
 * TDD: DUPLICATE_PREDICTION typed domain error — task 2.3 (RED)
 *
 * Verifies that the DuplicatePredictionError class:
 *  - is an instance of Error
 *  - has code === "DUPLICATE_PREDICTION"
 *  - carries the userId and matchId that caused the conflict
 *  - message is readable
 *
 * Spec (predictions): "a prediction already exists for (user, match) — second
 * INSERT for the same pair is attempted — DB constraint rejects it with a
 * unique-violation error" surfaced as a typed domain error.
 */

import { describe, it, expect } from "vitest";
import { DuplicatePredictionError } from "./duplicate-prediction";

describe("DuplicatePredictionError", () => {
  it("is an instance of Error", () => {
    const err = new DuplicatePredictionError("user-1", "match-1");
    expect(err).toBeInstanceOf(Error);
  });

  it("has code === DUPLICATE_PREDICTION", () => {
    const err = new DuplicatePredictionError("user-1", "match-1");
    expect(err.code).toBe("DUPLICATE_PREDICTION");
  });

  it("exposes the userId that caused the conflict", () => {
    const err = new DuplicatePredictionError("user-abc", "match-xyz");
    expect(err.userId).toBe("user-abc");
  });

  it("exposes the matchId that caused the conflict", () => {
    const err = new DuplicatePredictionError("user-abc", "match-xyz");
    expect(err.matchId).toBe("match-xyz");
  });

  it("has a readable message containing userId and matchId", () => {
    const err = new DuplicatePredictionError("user-abc", "match-xyz");
    expect(err.message).toContain("user-abc");
    expect(err.message).toContain("match-xyz");
  });

  it("can be narrowed with instanceof check", () => {
    const err: unknown = new DuplicatePredictionError("u", "m");
    if (err instanceof DuplicatePredictionError) {
      expect(err.code).toBe("DUPLICATE_PREDICTION");
    } else {
      throw new Error("instanceof check failed");
    }
  });
});

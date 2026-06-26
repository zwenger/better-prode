/**
 * aggregateBatchResults unit tests — RED → GREEN
 *
 * Covers:
 *  - All saved
 *  - Partial lock (mix of saved + locked)
 *  - All error
 *  - Empty input
 *  - Mixed all three outcomes
 */

import { describe, it, expect } from "vitest";
import { aggregateBatchResults } from "./aggregate-batch-results";

describe("aggregateBatchResults", () => {
  it("counts all-saved correctly", () => {
    const result = aggregateBatchResults({
      "match-1": { status: "saved" },
      "match-2": { status: "saved" },
      "match-3": { status: "saved" },
    });
    expect(result).toEqual({ saved: 3, locked: 0, error: 0, total: 3 });
  });

  it("counts partial lock correctly", () => {
    const result = aggregateBatchResults({
      "match-1": { status: "saved" },
      "match-2": { status: "locked" },
      "match-3": { status: "saved" },
    });
    expect(result).toEqual({ saved: 2, locked: 1, error: 0, total: 3 });
  });

  it("counts all-error correctly", () => {
    const result = aggregateBatchResults({
      "match-1": { status: "error", message: "Network failure" },
      "match-2": { status: "error" },
    });
    expect(result).toEqual({ saved: 0, locked: 0, error: 2, total: 2 });
  });

  it("returns zeroes for empty input", () => {
    const result = aggregateBatchResults({});
    expect(result).toEqual({ saved: 0, locked: 0, error: 0, total: 0 });
  });

  it("handles all three outcomes mixed", () => {
    const result = aggregateBatchResults({
      "match-1": { status: "saved" },
      "match-2": { status: "locked" },
      "match-3": { status: "error" },
      "match-4": { status: "saved" },
    });
    expect(result).toEqual({ saved: 2, locked: 1, error: 1, total: 4 });
  });

  it("total equals sum of saved + locked + error", () => {
    const result = aggregateBatchResults({
      "match-1": { status: "saved" },
      "match-2": { status: "locked" },
    });
    expect(result.total).toBe(result.saved + result.locked + result.error);
  });
});

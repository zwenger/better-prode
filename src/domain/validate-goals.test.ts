/**
 * TDD: validateGoals — W2 RED → GREEN
 *
 * Spec (predictions, admin apply-result):
 *   - Negative goals → error message
 *   - Non-integer goals (float, string, null) → error message
 *   - Missing / undefined → error message
 *   - Valid non-negative integers → null (no error)
 */

import { describe, it, expect } from "vitest";
import { validateGoals } from "./validate-goals";

describe("validateGoals", () => {
  it("returns null for valid zero goals", () => {
    expect(validateGoals(0, 0)).toBeNull();
  });

  it("returns null for valid positive integer goals", () => {
    expect(validateGoals(3, 2)).toBeNull();
  });

  it("returns error for negative homeGoals", () => {
    const result = validateGoals(-1, 0);
    expect(result).not.toBeNull();
    expect(result).toContain("homeGoals");
  });

  it("returns error for negative awayGoals", () => {
    const result = validateGoals(0, -1);
    expect(result).not.toBeNull();
    expect(result).toContain("awayGoals");
  });

  it("returns error for float homeGoals", () => {
    const result = validateGoals(1.5, 0);
    expect(result).not.toBeNull();
    expect(result).toContain("homeGoals");
  });

  it("returns error for float awayGoals", () => {
    const result = validateGoals(0, 2.7);
    expect(result).not.toBeNull();
    expect(result).toContain("awayGoals");
  });

  it("returns error for string homeGoals", () => {
    const result = validateGoals("2", 0);
    expect(result).not.toBeNull();
    expect(result).toContain("homeGoals");
  });

  it("returns error for null homeGoals", () => {
    const result = validateGoals(null, 0);
    expect(result).not.toBeNull();
    expect(result).toContain("homeGoals");
  });

  it("returns error for undefined awayGoals", () => {
    const result = validateGoals(0, undefined);
    expect(result).not.toBeNull();
    expect(result).toContain("awayGoals");
  });
});

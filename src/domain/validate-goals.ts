/**
 * Goal input validation — pure domain utility.
 *
 * Spec (predictions, admin apply-result): goal counts must be non-negative integers.
 * Both submit and admin apply-result use this to reject invalid input early.
 *
 * Returns an error message string if invalid, or null if valid.
 * Throwing is the caller's responsibility.
 */

export function validateGoals(homeGoals: unknown, awayGoals: unknown): string | null {
  if (!isNonNegativeInteger(homeGoals)) {
    return `homeGoals must be a non-negative integer, got: ${String(homeGoals)}`;
  }
  if (!isNonNegativeInteger(awayGoals)) {
    return `awayGoals must be a non-negative integer, got: ${String(awayGoals)}`;
  }
  return null;
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

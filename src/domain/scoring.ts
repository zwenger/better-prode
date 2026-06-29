/**
 * Scoring function — pure domain logic.
 *
 * Rules (priority order, per spec/scoring):
 *  1. Pleno: both home and away goals exact → 7 (flat; overrides additive rules)
 *  2. Correct outcome (W/D/L)              → +3
 *  3. Exact home goals                     → +1  (independent of outcome)
 *  4. Exact away goals                     → +1  (independent of outcome)
 *
 * Achievable totals: exactly {0, 1, 3, 4, 7}
 * Values 2, 5, 6 are unreachable by design.
 *
 * Design decision #1: pure function, no side effects, zero infra deps.
 * Computed once inside applyMatchResult, stored to prediction.points.
 */

export interface GoalCount {
  homeGoals: number;
  awayGoals: number;
}

/**
 * Points awarded for a Pleno (exact score on both sides). Flat value that
 * overrides the additive rules. Single source of truth — UI badges and the
 * scoring function both reference this so the "perfect prediction" value never
 * drifts.
 */
export const PLENO_POINTS = 7;

/**
 * Determine the match outcome from a goal count.
 * Returns 'home' | 'draw' | 'away'.
 */
function outcome(g: GoalCount): "home" | "draw" | "away" {
  if (g.homeGoals > g.awayGoals) return "home";
  if (g.homeGoals < g.awayGoals) return "away";
  return "draw";
}

/**
 * score(prediction, result) → points earned.
 *
 * @param prediction - The user's predicted score
 * @param result     - The actual match result
 * @returns Points in {0, 1, 3, 4, 7}
 */
export function score(prediction: GoalCount, result: GoalCount): number {
  // Rule 1: Pleno — exact score on both sides
  if (
    prediction.homeGoals === result.homeGoals &&
    prediction.awayGoals === result.awayGoals
  ) {
    return PLENO_POINTS;
  }

  // Rules 2–4 are additive (pleno did not match above)
  let points = 0;

  // Rule 2: correct match outcome
  if (outcome(prediction) === outcome(result)) {
    points += 3;
  }

  // Rule 3: exact home goals (independent of outcome)
  if (prediction.homeGoals === result.homeGoals) {
    points += 1;
  }

  // Rule 4: exact away goals (independent of outcome)
  if (prediction.awayGoals === result.awayGoals) {
    points += 1;
  }

  return points;
}

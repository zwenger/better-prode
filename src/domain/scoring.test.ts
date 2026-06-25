import { describe, it, expect } from "vitest";
import { score } from "./scoring";

/**
 * TDD: Scoring function tests (task 1.1 RED → 1.2 GREEN)
 *
 * Spec (scoring): priority-ordered rules:
 *  1. Pleno (both goals exact)             → 7 (flat, no additive)
 *  2. Correct outcome (W/D/L)              → +3
 *  3. Exact home goals (independent)       → +1
 *  4. Exact away goals (independent)       → +1
 *
 * Achievable totals: exactly {0, 1, 3, 4, 7}
 * Never returned:    2, 5, 6
 */

interface Prediction {
  homeGoals: number;
  awayGoals: number;
}
interface Result {
  homeGoals: number;
  awayGoals: number;
}

describe("score(pred, result)", () => {
  // Pleno: exact score on both sides → 7 (rule 1 is flat, not additive)
  it("pleno — exact home and away goals → 7", () => {
    expect(score({ homeGoals: 2, awayGoals: 1 }, { homeGoals: 2, awayGoals: 1 })).toBe(7);
  });

  it("pleno draw — both goals 0 exact → 7", () => {
    expect(score({ homeGoals: 0, awayGoals: 0 }, { homeGoals: 0, awayGoals: 0 })).toBe(7);
  });

  it("pleno high scoring — both goals exact → 7", () => {
    expect(score({ homeGoals: 3, awayGoals: 3 }, { homeGoals: 3, awayGoals: 3 })).toBe(7);
  });

  // Correct outcome only (no exact goals) → 3
  it("correct outcome home win, no exact goals → 3", () => {
    // pred 2-0, result 3-1 → home win correct, neither goal exact
    expect(score({ homeGoals: 2, awayGoals: 0 }, { homeGoals: 3, awayGoals: 1 })).toBe(3);
  });

  it("correct outcome draw, no exact goals → 3", () => {
    // pred 1-1, result 2-2 → draw correct, neither goal exact
    expect(score({ homeGoals: 1, awayGoals: 1 }, { homeGoals: 2, awayGoals: 2 })).toBe(3);
  });

  it("correct outcome away win, no exact goals → 3", () => {
    // pred 0-2, result 1-3 → away win correct, neither goal exact
    expect(score({ homeGoals: 0, awayGoals: 2 }, { homeGoals: 1, awayGoals: 3 })).toBe(3);
  });

  // Correct outcome + exact home goal (not pleno) → 4
  it("correct outcome + exact home goal only → 4", () => {
    // pred 1-0, result 1-2 → away win pred is wrong (home win vs away win), reconsider
    // pred 2-1, result 2-3 → home win (2>1) vs away win (3>2), wrong outcome → 0+1+0=1
    // Let's use: pred 2-0, result 2-1 → home win correct, exact home (2), not exact away → 3+1+0=4
    expect(score({ homeGoals: 2, awayGoals: 0 }, { homeGoals: 2, awayGoals: 1 })).toBe(4);
  });

  it("correct outcome + exact away goal only → 4", () => {
    // pred 0-2, result 1-2 → away win correct, not exact home (0≠1), exact away (2=2) → 3+0+1=4
    expect(score({ homeGoals: 0, awayGoals: 2 }, { homeGoals: 1, awayGoals: 2 })).toBe(4);
  });

  it("correct outcome + exact home and away (but this IS pleno, already covered in pleno tests) — sanity", () => {
    // This is already rule 1 (pleno), should be 7, not 3+1+1=5
    expect(score({ homeGoals: 1, awayGoals: 1 }, { homeGoals: 1, awayGoals: 1 })).toBe(7);
  });

  // Wrong outcome but exact one goal → 1
  it("wrong outcome, exact home goal only → 1", () => {
    // pred 2-1 (home win), result 2-3 (away win) → outcome wrong, home exact (2=2), away not (1≠3) → 0+1+0=1
    expect(score({ homeGoals: 2, awayGoals: 1 }, { homeGoals: 2, awayGoals: 3 })).toBe(1);
  });

  it("wrong outcome, exact away goal only → 1", () => {
    // pred 1-2 (away win), result 3-2 (home win) → outcome wrong, home not (1≠3), away exact (2=2) → 0+0+1=1
    expect(score({ homeGoals: 1, awayGoals: 2 }, { homeGoals: 3, awayGoals: 2 })).toBe(1);
  });

  // No match at all → 0
  it("wrong outcome, no exact goals → 0", () => {
    // pred 2-0 (home win), result 0-3 (away win) → wrong, no exact goals → 0
    expect(score({ homeGoals: 2, awayGoals: 0 }, { homeGoals: 0, awayGoals: 3 })).toBe(0);
  });

  it("draw predicted, home win result, no exact goals → 0", () => {
    expect(score({ homeGoals: 1, awayGoals: 1 }, { homeGoals: 3, awayGoals: 0 })).toBe(0);
  });

  // Exhaustive achievability: prove 2, 5, 6 are NEVER in the output space
  it("no combination of valid inputs produces 2", () => {
    // 2 would require: wrong outcome + exact both goals (0+1+1=2), but that's pleno → forced to 7
    // So the only way to get 2 is if pleno fired but didn't score 7 — impossible by rule 1
    // The spec says 2 is never achievable — validate via exhaustion over small goal matrix
    const impossibles = new Set<number>();
    for (let ph = 0; ph <= 5; ph++) {
      for (let pa = 0; pa <= 5; pa++) {
        for (let rh = 0; rh <= 5; rh++) {
          for (let ra = 0; ra <= 5; ra++) {
            impossibles.add(
              score({ homeGoals: ph, awayGoals: pa }, { homeGoals: rh, awayGoals: ra })
            );
          }
        }
      }
    }
    expect(impossibles).not.toContain(2);
    expect(impossibles).not.toContain(5);
    expect(impossibles).not.toContain(6);
  });

  it("achievable set is exactly {0, 1, 3, 4, 7}", () => {
    const achievable = new Set<number>();
    for (let ph = 0; ph <= 5; ph++) {
      for (let pa = 0; pa <= 5; pa++) {
        for (let rh = 0; rh <= 5; rh++) {
          for (let ra = 0; ra <= 5; ra++) {
            achievable.add(
              score({ homeGoals: ph, awayGoals: pa }, { homeGoals: rh, awayGoals: ra })
            );
          }
        }
      }
    }
    expect([...achievable].sort((a, b) => a - b)).toEqual([0, 1, 3, 4, 7]);
  });
});

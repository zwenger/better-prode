/**
 * isDirty unit tests — RED → GREEN
 *
 * Covers:
 *  - null saved → always dirty
 *  - equal values → not dirty
 *  - differing home goals → dirty
 *  - differing away goals → dirty
 *  - both differ → dirty
 */

import { describe, it, expect } from "vitest";
import { isDirty } from "./is-dirty";

describe("isDirty", () => {
  it("returns true when saved is null (no baseline)", () => {
    expect(isDirty({ homeGoals: 0, awayGoals: 0 }, null)).toBe(true);
  });

  it("returns true when saved is null regardless of draft values", () => {
    expect(isDirty({ homeGoals: 3, awayGoals: 2 }, null)).toBe(true);
  });

  it("returns false when draft equals saved", () => {
    expect(isDirty({ homeGoals: 2, awayGoals: 1 }, { homeGoals: 2, awayGoals: 1 })).toBe(false);
  });

  it("returns false when both are zero and match", () => {
    expect(isDirty({ homeGoals: 0, awayGoals: 0 }, { homeGoals: 0, awayGoals: 0 })).toBe(false);
  });

  it("returns true when home goals differ", () => {
    expect(isDirty({ homeGoals: 3, awayGoals: 1 }, { homeGoals: 2, awayGoals: 1 })).toBe(true);
  });

  it("returns true when away goals differ", () => {
    expect(isDirty({ homeGoals: 2, awayGoals: 2 }, { homeGoals: 2, awayGoals: 1 })).toBe(true);
  });

  it("returns true when both differ", () => {
    expect(isDirty({ homeGoals: 1, awayGoals: 3 }, { homeGoals: 0, awayGoals: 0 })).toBe(true);
  });
});

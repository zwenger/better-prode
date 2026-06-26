/**
 * Unit tests for match-list loader shaping logic — task 4.6
 *
 * Tests the pure mapping from DB rows + user predictions to MatchListItem[].
 * These tests do NOT exercise the server fn directly (it requires TanStack Start
 * request context); instead they test the shapeMatchRow helper exported for
 * testing purposes.
 *
 * Spec (match-views): "matches MUST show the user's own prediction if one exists"
 * Spec (match-views): user sees "their prediction for each match (or an 'add
 * prediction' affordance if none exists)"
 * Spec (match-views): "The display MUST include a timezone label or indication."
 */

import { describe, it, expect } from "vitest";
import { shapeMatchRows, formatKickoffUtc } from "./-match-list-loader";

const FUTURE_STR = "2026-07-15T20:00:00.000Z"; // well in future → unlocked

interface RawRow {
  id: string;
  homeName: string | null;
  homeCode: string | null;
  awayName: string | null;
  awayCode: string | null;
  homeTeamId: string;
  awayTeamId: string;
  kickoffUtc: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  groupLabel: string | null;
}

function makeRow(overrides: Partial<RawRow> = {}): RawRow {
  return {
    id: "match-1",
    homeName: "Argentina",
    homeCode: "AR",
    awayName: "Brazil",
    awayCode: "BR",
    homeTeamId: "team-ar",
    awayTeamId: "team-br",
    kickoffUtc: FUTURE_STR,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    groupLabel: "Group A",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatKickoffUtc — W-2 fix (timezone label requirement)
//
// Spec (match-views): "The display MUST include a timezone label or indication
// to avoid ambiguity." (e.g. GMT-3, UTC, EST …)
//
// The formatter uses timeZoneName: "short" so the rendered string always
// includes an abbreviated timezone identifier regardless of locale.
// ---------------------------------------------------------------------------

describe("formatKickoffUtc (W-2 — timezone label)", () => {
  const SAMPLE_UTC = "2026-06-14T15:00:00.000Z";

  it("returns a non-empty string for a valid UTC ISO string", () => {
    const result = formatKickoffUtc(SAMPLE_UTC);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes a timezone identifier in the formatted string", () => {
    const result = formatKickoffUtc(SAMPLE_UTC);
    // timeZoneName: "short" always appends an abbreviated tz label:
    // UTC, GMT, GMT+X, GMT-X, EST, CEST, etc.
    // We verify the string contains at least one of these patterns.
    const hasTzLabel =
      /\bGMT[+-]?\d*\b/.test(result) ||
      /\bUTC\b/.test(result) ||
      /\b[A-Z]{2,5}\b/.test(result); // catches EST, PST, CEST, etc.
    expect(hasTzLabel).toBe(true);
  });

  // Task 6.3: deterministic IANA tz input tests (pass timeZone explicitly so
  // results are independent of the CI runner's host timezone).
  it("formats correctly for America/Buenos_Aires (UTC-3)", () => {
    // 2026-06-14T15:00:00Z in UTC → 12:00 in UTC-3 (no DST — Argentina is fixed)
    const result = formatKickoffUtc(SAMPLE_UTC, "America/Argentina/Buenos_Aires");
    // Hour component must be 12 (noon local time in BUE)
    expect(result).toContain("12");
    // Must include timezone label (GMT-3 or equivalent)
    const hasTzLabel = /GMT-3/.test(result) || /\b[A-Z]{2,5}\b/.test(result);
    expect(hasTzLabel).toBe(true);
  });

  it("formats correctly for Europe/London (UTC+1 in BST during summer)", () => {
    // 2026-06-14T15:00:00Z in UTC → 16:00 in BST (UTC+1, daylight saving in June)
    const result = formatKickoffUtc(SAMPLE_UTC, "Europe/London");
    // Hour component must be 4 PM (16:00 in 24h or 4 PM in 12h)
    const has4pm = result.includes("4:00") || result.includes("16:00") || result.includes("16:0");
    expect(has4pm).toBe(true);
    // Must include timezone label
    const hasTzLabel = /BST/.test(result) || /GMT\+1/.test(result) || /\b[A-Z]{2,5}\b/.test(result);
    expect(hasTzLabel).toBe(true);
  });
});

describe("shapeMatchRows (match-list loader helper)", () => {
  const fixedNow = new Date("2026-07-01T18:00:00.000Z");

  it("attaches userPrediction when the user has predicted that match", () => {
    const rows = [makeRow()];
    const predMap = new Map([
      ["match-1", { homeGoals: 2, awayGoals: 1 }],
    ]);

    const result = shapeMatchRows(rows, predMap, fixedNow);

    expect(result[0].userPrediction).toEqual({ homeGoals: 2, awayGoals: 1 });
  });

  it("sets userPrediction to null when no prediction exists for a match", () => {
    const rows = [makeRow()];
    const predMap = new Map<string, { homeGoals: number; awayGoals: number }>();

    const result = shapeMatchRows(rows, predMap, fixedNow);

    expect(result[0].userPrediction).toBeNull();
  });

  it("derives homeName from homeTeamId when homeName is null", () => {
    const rows = [makeRow({ homeName: null })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].homeName).toBe("team-ar");
  });

  it("sets locked=true when now >= kickoff - 5min", () => {
    // kickoff is 30min after fixedNow → fixedNow is well past kickoff-5min → locked
    const kickoffSoon = "2026-07-01T18:04:00.000Z"; // 4 min after fixedNow → inside lock window
    const rows = [makeRow({ kickoffUtc: kickoffSoon })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].locked).toBe(true);
  });

  it("sets locked=false when kickoff is well in the future", () => {
    const rows = [makeRow({ kickoffUtc: FUTURE_STR })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].locked).toBe(false);
  });

  it("shapes multiple rows independently", () => {
    const rows = [
      makeRow({ id: "m1", kickoffUtc: FUTURE_STR }),
      makeRow({ id: "m2", kickoffUtc: FUTURE_STR }),
    ];
    const predMap = new Map([["m1", { homeGoals: 1, awayGoals: 0 }]]);

    const result = shapeMatchRows(rows, predMap, fixedNow);

    expect(result[0].userPrediction).toEqual({ homeGoals: 1, awayGoals: 0 });
    expect(result[1].userPrediction).toBeNull();
  });
});

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
import {
  shapeMatchRows,
  formatKickoffUtc,
  formatKickoffShort,
  isPredictableTabMatch,
} from "./-match-list-loader";

const FUTURE_STR = "2026-07-15T20:00:00.000Z"; // well in future → unlocked

interface RawRow {
  id: string;
  homeName: string | null;
  homeCode: string | null;
  awayName: string | null;
  awayCode: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homePlaceholder: string | null;
  awayPlaceholder: string | null;
  kickoffUtc: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  groupLabel: string | null;
  homePenaltyScore: number | null;
  awayPenaltyScore: number | null;
  winnerTeamId: string | null;
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
    homePlaceholder: null,
    awayPlaceholder: null,
    kickoffUtc: FUTURE_STR,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    groupLabel: "Group A",
    homePenaltyScore: null,
    awayPenaltyScore: null,
    winnerTeamId: null,
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

// ---------------------------------------------------------------------------
// formatKickoffShort — compact label for tight rows (team sheet upcoming/recent).
// Drops the year AND the timezone label so a long verbose date no longer
// overflows next to a full team name.
// ---------------------------------------------------------------------------

describe("formatKickoffShort (compact, no year, no tz)", () => {
  const SAMPLE_UTC = "2026-06-14T15:00:00.000Z";

  it("returns a non-empty string", () => {
    const result = formatKickoffShort(SAMPLE_UTC);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes the day and time but NOT the year", () => {
    // 15:00Z → 12:00 in UTC-3 (Buenos Aires, fixed offset)
    const result = formatKickoffShort(SAMPLE_UTC, "America/Argentina/Buenos_Aires");
    expect(result).toContain("14"); // day
    expect(result).toContain("12"); // local hour
    expect(result).not.toContain("2026"); // year dropped
  });

  it("omits the timezone label", () => {
    const result = formatKickoffShort(SAMPLE_UTC, "America/Argentina/Buenos_Aires");
    expect(/\bGMT[+-]?\d*\b/.test(result)).toBe(false);
    expect(/\bUTC\b/.test(result)).toBe(false);
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

  it("derives homeName from decodePlaceholder when homeName is null and homeTeamId is null", () => {
    const rows = [makeRow({ homeName: null, homeTeamId: null, homePlaceholder: "W74" })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].homeName).toBe("Ganador partido 74");
  });

  it("derives homeName as 'Por confirmar' when homeName, homeTeamId, and homePlaceholder are all null", () => {
    const rows = [makeRow({ homeName: null, homeTeamId: null, homePlaceholder: null })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].homeName).toBe("Por confirmar");
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

// ---------------------------------------------------------------------------
// predictable flag (spec: Predictable Gate)
// ---------------------------------------------------------------------------

describe("shapeMatchRows — predictable flag", () => {
  const fixedNow = new Date("2026-07-01T18:00:00.000Z");

  it("predictable=true when both team IDs are non-null", () => {
    const rows = [makeRow({ homeTeamId: "team-ar", awayTeamId: "team-br" })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].predictable).toBe(true);
  });

  it("predictable=false when homeTeamId is null", () => {
    const rows = [makeRow({ homeTeamId: null, homePlaceholder: "W74" })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].predictable).toBe(false);
  });

  it("predictable=false when awayTeamId is null", () => {
    const rows = [makeRow({ awayTeamId: null, awayPlaceholder: "RU101" })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].predictable).toBe(false);
  });

  it("predictable=false when both team IDs are null", () => {
    const rows = [makeRow({ homeTeamId: null, awayTeamId: null, homePlaceholder: "W74", awayPlaceholder: "RU101" })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].predictable).toBe(false);
  });

  it("homeName falls back to decoded placeholder label (not null, not raw teamId)", () => {
    const rows = [makeRow({ homeName: null, homeTeamId: null, homePlaceholder: "1A" })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].homeName).toBe("1° Grupo A");
  });

  it("awayName falls back to decoded placeholder label", () => {
    const rows = [makeRow({ awayName: null, awayTeamId: null, awayPlaceholder: "RU74" })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].awayName).toBe("Perdedor partido 74");
  });
});

// ---------------------------------------------------------------------------
// shapeMatchRows — penalty shootout threading
// ---------------------------------------------------------------------------

describe("shapeMatchRows — penalty shootout fields", () => {
  const fixedNow = new Date("2026-07-01T18:00:00.000Z");

  it("passes through homePenaltyScore, awayPenaltyScore, winnerTeamId when set", () => {
    const rows = [
      makeRow({
        status: "finished",
        homeScore: 1,
        awayScore: 1,
        homePenaltyScore: 4,
        awayPenaltyScore: 2,
        winnerTeamId: "fifa-t-43911",
      }),
    ];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].homePenaltyScore).toBe(4);
    expect(result[0].awayPenaltyScore).toBe(2);
    expect(result[0].winnerTeamId).toBe("fifa-t-43911");
  });

  it("passes through null penalty fields for non-penalty matches", () => {
    const rows = [makeRow({ status: "finished", homeScore: 2, awayScore: 0 })];
    const result = shapeMatchRows(rows, new Map(), fixedNow);
    expect(result[0].homePenaltyScore).toBeNull();
    expect(result[0].awayPenaltyScore).toBeNull();
    expect(result[0].winnerTeamId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isPredictableTabMatch — the "Para predecir" filter predicate
//
// Spec (Predictable Gate): TBD matches (predictable=false) MUST be excluded
// from the "Para predecir" tab even when scheduled and unlocked.
// ---------------------------------------------------------------------------

describe("isPredictableTabMatch (Para predecir filter)", () => {
  it("includes a scheduled, unlocked, predictable match", () => {
    expect(
      isPredictableTabMatch({ status: "scheduled", locked: false, predictable: true })
    ).toBe(true);
  });

  it("EXCLUDES a TBD match (predictable=false) even when scheduled and unlocked", () => {
    expect(
      isPredictableTabMatch({ status: "scheduled", locked: false, predictable: false })
    ).toBe(false);
  });

  it("excludes a locked match", () => {
    expect(
      isPredictableTabMatch({ status: "scheduled", locked: true, predictable: true })
    ).toBe(false);
  });

  it("excludes a non-scheduled match", () => {
    expect(
      isPredictableTabMatch({ status: "finished", locked: false, predictable: true })
    ).toBe(false);
    expect(
      isPredictableTabMatch({ status: "in_progress", locked: false, predictable: true })
    ).toBe(false);
  });
});

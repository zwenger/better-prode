// @vitest-environment jsdom
/**
 * TDD 7.2 (RED): PredictableMatchCard — TBD (predictable=false) treatment.
 *
 * Spec:
 *  - When predictable=false: no stepper and no save button rendered
 *  - Decoded placeholder label is displayed (not raw code, not undefined)
 *
 * Mock strategy: PredictionDrawer pulls auth→DB at module load; TeamButton
 * and MatchDetailLink pull router context. All three are mocked via vi.mock()
 * (hoisted by Vitest) — 3 mocks total, all justified by infra boundary.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PredictableMatchCard } from "./predictable-match-card";
import type { MatchListItem } from "#/routes/matches/-match-list-loader";

// Vitest hoists vi.mock() calls to the top of the module at transform time,
// so these execute before any import side effects.
vi.mock("#/components/prediction-drawer", () => ({
  PredictionDrawer: () => null,
}));
vi.mock("#/components/match-detail-link", () => ({
  MatchDetailLink: () => null,
}));
vi.mock("#/components/team-button", () => ({
  TeamButton: ({ name }: { name: string }) => <span>{name}</span>,
}));

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeMatch(overrides: Partial<MatchListItem> = {}): MatchListItem {
  return {
    id: "match-tbd-test",
    homeName: "Ganador partido 74",
    homeCode: null,
    awayName: "Perdedor partido 101",
    awayCode: null,
    kickoffUtc: "2026-08-01T20:00:00.000Z",
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    groupLabel: null,
    locked: false,
    predictable: false,
    userPrediction: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TBD card: predictable=false → no steppers, no save button
// ---------------------------------------------------------------------------

describe("PredictableMatchCard — TBD match (predictable=false)", () => {
  it("does not render a save/submit button when predictable=false", () => {
    render(
      <PredictableMatchCard
        match={makeMatch({ predictable: false })}
        onTeamPress={vi.fn()}
      />
    );
    expect(screen.queryByTestId("submit-prediction")).toBeNull();
  });

  it("does not render score steppers when predictable=false", () => {
    render(
      <PredictableMatchCard
        match={makeMatch({ predictable: false })}
        onTeamPress={vi.fn()}
      />
    );
    // ScoreStepper exposes value span with aria-label matching the label prop
    expect(screen.queryByLabelText("home goals")).toBeNull();
    expect(screen.queryByLabelText("away goals")).toBeNull();
  });

  it("displays the decoded home placeholder label", () => {
    render(
      <PredictableMatchCard
        match={makeMatch({ predictable: false, homeName: "Ganador partido 74" })}
        onTeamPress={vi.fn()}
      />
    );
    expect(screen.getByText("Ganador partido 74")).toBeTruthy();
  });

  it("displays the decoded away placeholder label", () => {
    render(
      <PredictableMatchCard
        match={makeMatch({ predictable: false, awayName: "Perdedor partido 101" })}
        onTeamPress={vi.fn()}
      />
    );
    expect(screen.getByText("Perdedor partido 101")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Concrete match: predictable=true → normal rendering
// ---------------------------------------------------------------------------

describe("PredictableMatchCard — concrete match (predictable=true)", () => {
  it("renders the save button when predictable=true and not locked", () => {
    render(
      <PredictableMatchCard
        match={makeMatch({
          predictable: true,
          homeName: "Argentina",
          homeCode: "AR",
          awayName: "Brazil",
          awayCode: "BR",
        })}
        onTeamPress={vi.fn()}
      />
    );
    expect(screen.queryByTestId("submit-prediction")).toBeTruthy();
  });

  it("renders score steppers when predictable=true", () => {
    render(
      <PredictableMatchCard
        match={makeMatch({
          predictable: true,
          homeName: "Argentina",
          homeCode: "AR",
          awayName: "Brazil",
          awayCode: "BR",
        })}
        onTeamPress={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("home goals")).toBeTruthy();
    expect(screen.queryByLabelText("away goals")).toBeTruthy();
  });
});

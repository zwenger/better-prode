// @vitest-environment jsdom
/**
 * Render-level guard for the penalty annotation.
 *
 * Spec (penalty shootout — display): a penalty-decided finished match shows a
 * shootout annotation; a NON-penalty finished match must show NONE.
 *
 * ResultOnlyRow is the simplest annotation-rendering surface (it only depends on
 * TeamFlag and a MatchListItem). The route module pulls infra at import time only
 * inside deferred server-fn handlers, but TeamFlag and the prediction drawer
 * reach for router/auth context — so they are mocked at the infra boundary.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MatchListItem } from "#/routes/matches/-match-list-loader";
// vi.mock calls below are hoisted by Vitest above this import at transform time,
// so the route module's infra imports are already stubbed before it loads.
import { ResultOnlyRow } from "../index";

// Infra-boundary mocks. The route module imports auth, which calls getDb() at
// module load — stub the auth + db modules so the import chain never touches
// a real database. ResultOnlyRow itself depends on none of this.
vi.mock("#/infra/auth/auth", () => ({ auth: {} }));
vi.mock("#/infra/db/client", () => ({ getDb: () => ({}) }));
vi.mock("#/components/team-flag", () => ({
  TeamFlag: ({ code }: { code: string | null }) => <span>{code ?? "?"}</span>,
}));
vi.mock("#/components/prediction-drawer", () => ({
  PredictionDrawer: () => null,
}));
vi.mock("#/components/match-detail-link", () => ({
  MatchDetailLink: () => null,
}));
vi.mock("#/components/team-button", () => ({
  TeamButton: ({ name }: { name: string }) => <span>{name}</span>,
}));

function makeMatch(overrides: Partial<MatchListItem> = {}): MatchListItem {
  return {
    id: "m-1",
    homeName: "Mexico",
    homeCode: "MX",
    awayName: "South Africa",
    awayCode: "ZA",
    kickoffUtc: "2026-07-05T20:00:00.000Z",
    status: "finished",
    homeScore: 1,
    awayScore: 1,
    groupLabel: null,
    locked: true,
    predictable: true,
    userPrediction: null,
    homePenaltyScore: null,
    awayPenaltyScore: null,
    winnerTeamId: null,
    penaltyWinnerName: null,
    ...overrides,
  };
}

describe("ResultOnlyRow — penalty annotation visibility", () => {
  it("renders the penalty annotation for a penalty-decided match", () => {
    render(
      <ResultOnlyRow
        match={makeMatch({
          homePenaltyScore: 4,
          awayPenaltyScore: 2,
          winnerTeamId: "fifa-t-43911",
          penaltyWinnerName: "Mexico",
        })}
      />
    );
    const annotation = screen.queryByTestId("penalty-annotation");
    expect(annotation).not.toBeNull();
    expect(annotation!.textContent).toContain("en penales");
  });

  it("renders NO penalty annotation for a non-penalty finished match", () => {
    render(<ResultOnlyRow match={makeMatch({ homeScore: 2, awayScore: 0 })} />);
    expect(screen.queryByTestId("penalty-annotation")).toBeNull();
    expect(screen.queryByText(/en penales/)).toBeNull();
  });
});

// @vitest-environment jsdom
/**
 * TDD 8.1 (RED): MatchDetailPredictionArea component tests.
 *
 * Spec (Match Detail — Equipos por Confirmar Banner):
 *  - predictable=false → banner "Equipos por confirmar" shown, no prediction-editor
 *  - predictable=true + isOpen → PredictionEditor shown, no banner
 *
 * Extracted pure component approach: testing the prediction area section
 * in isolation avoids mocking the full route loader.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatchDetailPredictionArea } from "../-match-detail-prediction-area";

// Mock server fns that pull in infra at module load time. vitest hoists vi.mock
// above the imports at transform time, so the mock still applies to the import above.
vi.mock("#/routes/api/predictions/-submit", () => ({
  submitPrediction: vi.fn(),
}));

describe("MatchDetailPredictionArea — TBD match (predictable=false)", () => {
  it("renders the 'Equipos por confirmar' banner", () => {
    render(
      <MatchDetailPredictionArea
        matchId="m-tbd"
        predictable={false}
        isOpen={false}
        prediction={null}
        isFinished={false}
      />
    );
    expect(screen.getByText("Equipos por confirmar")).toBeTruthy();
  });

  it("does not render the prediction editor (no save button)", () => {
    render(
      <MatchDetailPredictionArea
        matchId="m-tbd"
        predictable={false}
        isOpen={true}
        prediction={null}
        isFinished={false}
      />
    );
    expect(screen.queryByTestId("prediction-editor")).toBeNull();
    expect(screen.queryByTestId("save-prediction")).toBeNull();
  });
});

describe("MatchDetailPredictionArea — partial match (one team set, one TBD)", () => {
  // A partial match (e.g. homeTeamId set, awayTeamId null) shapes to
  // predictable=false in the loader, so the detail area must render the TBD
  // banner — NOT the editor — even though one side is concrete.
  it("renders the TBD banner and NOT the editor when predictable=false", () => {
    render(
      <MatchDetailPredictionArea
        matchId="m-partial"
        predictable={false}
        isOpen={true}
        prediction={null}
        isFinished={false}
      />
    );
    expect(screen.getByTestId("tbd-banner")).toBeTruthy();
    expect(screen.getByText("Equipos por confirmar")).toBeTruthy();
    expect(screen.queryByTestId("prediction-editor")).toBeNull();
    expect(screen.queryByTestId("save-prediction")).toBeNull();
  });
});

describe("MatchDetailPredictionArea — concrete match (predictable=true)", () => {
  it("renders the prediction editor when isOpen=true", () => {
    render(
      <MatchDetailPredictionArea
        matchId="m-concrete"
        predictable={true}
        isOpen={true}
        prediction={null}
        isFinished={false}
      />
    );
    expect(screen.queryByTestId("prediction-editor")).toBeTruthy();
  });

  it("does not show the TBD banner when predictable=true", () => {
    render(
      <MatchDetailPredictionArea
        matchId="m-concrete"
        predictable={true}
        isOpen={true}
        prediction={null}
        isFinished={false}
      />
    );
    expect(screen.queryByText("Equipos por confirmar")).toBeNull();
  });
});

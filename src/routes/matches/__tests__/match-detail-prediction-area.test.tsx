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

// Mock server fns that pull in infra at module load time
vi.mock("#/routes/api/predictions/-submit", () => ({
  submitPrediction: vi.fn(),
}));

import { MatchDetailPredictionArea } from "../-match-detail-prediction-area";

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

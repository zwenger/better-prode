/**
 * MatchDetailPredictionArea — extracted prediction section for the match detail page.
 *
 * Handles three states:
 *  1. TBD match (predictable=false): "Equipos por confirmar" banner, no editor.
 *  2. Open match (predictable=true, isOpen=true): editable PredictionEditor.
 *  3. Locked/finished match: read-only prediction or "no prediction" message.
 *
 * Extracted from $matchId.tsx to make this section unit-testable without
 * requiring the full TanStack Router route context.
 */

import { useState } from "react";
import { ScoreStepper } from "#/components/score-stepper";
import { PointsBadge } from "#/components/points-badge";

/**
 * A settled prediction as shown on the match detail page: the user's score plus
 * the points it earned (null until the match is settled). Distinct from the
 * loader's `UserPrediction` ({homeGoals, awayGoals}), which carries no points
 * because it feeds the editable steppers.
 */
export interface SettledPrediction {
  homeGoals: number;
  awayGoals: number;
  points: number | null;
}

/** Editable prediction steppers + save button (identical to the inline version). */
function PredictionEditor({
  matchId,
  initialHome,
  initialAway,
}: {
  matchId: string;
  initialHome: number;
  initialAway: number;
}) {
  const [homeGoals, setHomeGoals] = useState(initialHome);
  const [awayGoals, setAwayGoals] = useState(initialAway);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "locked" | "error">("idle");

  const handleSave = async () => {
    setState("saving");
    try {
      const { submitPrediction } = await import("#/routes/api/predictions/-submit");
      await submitPrediction({ data: { matchId, homeGoals, awayGoals } });
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setState(status === 422 ? "locked" : "error");
    }
  };

  return (
    <div className="border rounded-2xl p-4 space-y-3" data-testid="prediction-editor">
      <h2 className="text-sm font-semibold text-muted-foreground">Tu predicción</h2>
      <div className="flex items-center justify-center gap-4">
        <ScoreStepper value={homeGoals} onChange={setHomeGoals} label="home goals" />
        <span className="text-xl font-bold text-muted-foreground font-score">:</span>
        <ScoreStepper value={awayGoals} onChange={setAwayGoals} label="away goals" />
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={state === "saving" || state === "saved"}
        aria-live="polite"
        className={[
          "w-full py-3 rounded-xl text-sm font-semibold select-none",
          "transition-[background-color,transform,box-shadow] duration-200 ease-out",
          "active:scale-[0.98] disabled:active:scale-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          state === "saved"
            ? "bg-pitch-green text-surface shadow-lifted"
            : "bg-primary text-primary-foreground hover:bg-pitch-green-deep disabled:opacity-50",
        ].join(" ")}
        data-testid="save-prediction"
      >
        <span className="inline-flex items-center justify-center gap-1.5">
          {state === "saving" ? "Guardando…" : state === "saved" ? "¡Guardado!" : "Guardar predicción"}
        </span>
      </button>
      {state === "locked" && (
        <p className="text-xs text-center text-muted-foreground" data-testid="prediction-locked">
          El partido ya está cerrado.
        </p>
      )}
      {state === "error" && (
        <p className="text-xs text-center" style={{ color: "var(--miss-red-ink)" }}>
          No se pudo guardar. Intentá de nuevo.
        </p>
      )}
      <p className="text-[11px] text-center text-muted-foreground">
        Se cierra 5 minutos antes del inicio
      </p>
    </div>
  );
}

export interface MatchDetailPredictionAreaProps {
  matchId: string;
  /** True when both home and away team IDs are confirmed. */
  predictable: boolean;
  /** True when the match is still open for predictions (scheduled + not locked). */
  isOpen: boolean;
  prediction: SettledPrediction | null;
  isFinished: boolean;
}

/**
 * Renders the appropriate prediction section for a match detail page.
 *
 * - TBD (predictable=false): static "Equipos por confirmar" banner.
 * - Open (predictable=true, isOpen=true): editable PredictionEditor.
 * - Locked/finished: read-only prediction summary.
 */
export function MatchDetailPredictionArea({
  matchId,
  predictable,
  isOpen,
  prediction,
  isFinished,
}: MatchDetailPredictionAreaProps) {
  if (!predictable) {
    return (
      <div
        className="border rounded-2xl p-4 text-center text-sm text-muted-foreground"
        data-testid="tbd-banner"
      >
        Equipos por confirmar
      </div>
    );
  }

  if (isOpen) {
    return (
      <PredictionEditor
        matchId={matchId}
        initialHome={prediction?.homeGoals ?? 0}
        initialAway={prediction?.awayGoals ?? 0}
      />
    );
  }

  if (prediction) {
    return (
      <div className="border rounded-2xl p-4" data-testid="user-prediction">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Tu predicción</h2>
          {isFinished && prediction.points !== null && (
            <PointsBadge points={prediction.points} />
          )}
        </div>
        <div className="mt-2 text-xl font-bold tabular-nums font-score">
          {prediction.homeGoals} : {prediction.awayGoals}
        </div>
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      {isFinished
        ? "No hiciste una predicción para este partido."
        : "El partido está cerrado y no hiciste una predicción."}
    </p>
  );
}

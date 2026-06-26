/**
 * PredictableMatchCard — shared controlled card for unlocked scheduled matches.
 *
 * Used by both /matches and /today to eliminate duplication and ensure both
 * routes share identical behaviour and testid contracts.
 *
 * E2E testid contract (MUST NOT change without updating e2e tests):
 *   data-testid="match-card"         — article element
 *   data-match-id={match.id}         — article attribute
 *   data-testid="submit-prediction"  — save/edit button
 *   data-testid="prediction-saved"   — transient "¡Guardado!" confirmation
 *   data-testid="prediction-locked"  — locked indicator paragraph
 *
 * ScoreStepper aria-label contract (MUST NOT change):
 *   label="home goals" → aria-label="Increase home goals" / "Decrease home goals"
 *                         aria-label="home goals" (value span)
 *   label="away goals" → aria-label="Increase away goals" / "Decrease away goals"
 *                         aria-label="away goals" (value span)
 *
 * Bug fix (item 5): after a successful save the card returns to an EDITABLE
 * state — button is re-labeled "Editar predicción" and NEVER permanently hidden
 * for an unlocked match. A transient "¡Guardado!" flash (~1.5 s, instant under
 * prefers-reduced-motion) bridges the gap before returning to the button.
 * `clearTimeout` on unmount prevents state updates on an unmounted card.
 *
 * PR1 note: value/onChange are intentionally designed for PR2's page-owned draft
 * Map. For PR1 the card self-manages its draft state internally (seeded from
 * savedValue) while exposing the full controlled-ready props interface so PR2
 * can switch to fully controlled mode without a component rewrite.
 */

import { useState, useEffect, useRef } from "react";
import { ScoreStepper } from "#/components/score-stepper";
import { TeamButton } from "#/components/team-button";
import { PredictionDrawer } from "#/components/prediction-drawer";
import { formatKickoffUtc } from "#/routes/matches/-match-list-loader";
import type { MatchListItem } from "#/routes/matches/-match-list-loader";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Goals {
  homeGoals: number;
  awayGoals: number;
}

export interface PredictableMatchCardProps {
  match: MatchListItem;
  /** Controlled draft value; when omitted the card seeds from match.userPrediction. */
  value?: Goals;
  /** Called on every stepper change when the card is fully controlled. */
  onChange?: (next: Goals) => void;
  /** Last persisted value (the saved baseline). null when never saved. */
  savedValue?: Goals | null;
  /** Called when the user clicks save. The card handles its own submit flow. */
  onSave?: () => Promise<void>;
  /** Optional submitting override for batch mode (PR2). */
  submitting?: boolean;
  /** Server-confirmed lock state (422 throw from submitPredictionCore). */
  locked?: boolean;
  onTeamPress: (code: string | null, name: string) => void;
  /** userId — used to redirect unauthenticated users to "/" */
  userId?: string | null;
  /**
   * submitFn — the actual network call. Defaults to the imported submitPrediction
   * server fn. PR2 can inject a custom fn for batch flow or testing.
   */
  submitFn?: (args: {
    data: { matchId: string; homeGoals: number; awayGoals: number };
  }) => Promise<{ locked?: boolean | null }>;
}

// Reduced-motion detection — runs once outside the component so it is not
// re-evaluated on every render.
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const SAVED_FLASH_DURATION_MS = 1500;

// ---------------------------------------------------------------------------
// Default submit function — lazily imported to avoid circular deps in tests
// ---------------------------------------------------------------------------

async function defaultSubmitFn(args: {
  data: { matchId: string; homeGoals: number; awayGoals: number };
}): Promise<{ locked?: boolean | null }> {
  // Dynamic import keeps the server fn out of the component's module graph
  // when a stub is injected (e.g. in unit / integration tests).
  const { submitPrediction } = await import(
    "#/routes/api/predictions/-submit"
  );
  return submitPrediction(args);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PredictableMatchCard({
  match,
  value,
  onChange,
  savedValue,
  onSave,
  submitting: submittingProp,
  locked: lockedProp = false,
  onTeamPress,
  // userId is accepted for future use (e.g. redirect on unauthenticated submit)
  // but the server fn itself enforces auth — no client-side redirect needed here.
  userId: _userId,
  submitFn = defaultSubmitFn,
}: PredictableMatchCardProps) {
  // Internal draft state — used when the card is NOT fully controlled (PR1 mode).
  const seed = match.userPrediction;
  const [internalHomeGoals, setInternalHomeGoals] = useState(
    seed?.homeGoals ?? 0
  );
  const [internalAwayGoals, setInternalAwayGoals] = useState(
    seed?.awayGoals ?? 0
  );

  // Resolved draft values: prefer controlled props, fall back to internal state.
  const homeGoals = value !== undefined ? value.homeGoals : internalHomeGoals;
  const awayGoals = value !== undefined ? value.awayGoals : internalAwayGoals;

  const handleHomeChange = (v: number) => {
    if (onChange && value !== undefined) {
      onChange({ homeGoals: v, awayGoals });
    } else {
      setInternalHomeGoals(v);
    }
  };

  const handleAwayChange = (v: number) => {
    if (onChange && value !== undefined) {
      onChange({ homeGoals, awayGoals: v });
    } else {
      setInternalAwayGoals(v);
    }
  };

  // ---------------------------------------------------------------------------
  // Submit state machine — bug fix (item 5)
  //
  // States:
  //   idle       — ready to submit (button visible)
  //   submitting — network request in flight (button disabled)
  //   saved      — transient flash (~1.5 s); auto-clears to idle
  //   locked     — server returned 422 (permanent for this session)
  //   error      — network or unexpected error (button re-enables)
  // ---------------------------------------------------------------------------

  type SubmitState = "idle" | "submitting" | "saved" | "locked" | "error";
  const [submitState, setSubmitState] = useState<SubmitState>("idle");

  // Track the last saved baseline locally so "hasPrediction" stays up-to-date
  // after a successful save without a page reload.
  const [hasSavedLocally, setHasSavedLocally] = useState(
    match.userPrediction !== null || (savedValue !== undefined && savedValue !== null)
  );

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount to prevent state updates on an unmounted card.
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const isSubmitting = submittingProp ?? submitState === "submitting";

  const handleSubmit = async () => {
    if (onSave) {
      // Fully controlled mode (PR2): delegate to the parent's save handler.
      await onSave();
      return;
    }

    setSubmitState("submitting");
    try {
      const result = await submitFn({
        data: { matchId: match.id, homeGoals, awayGoals },
      });

      if (result.locked) {
        // 422 lock caught and surfaced as a result — treat as server lock.
        setSubmitState("locked");
        return;
      }

      // Success: flash "¡Guardado!" then return to editable.
      setHasSavedLocally(true);
      setSubmitState("saved");

      const delay = prefersReducedMotion() ? 0 : SAVED_FLASH_DURATION_MS;
      timeoutRef.current = setTimeout(() => {
        setSubmitState("idle");
        timeoutRef.current = null;
      }, delay);
    } catch (err: unknown) {
      // 422 thrown directly (older code path) — treat as locked.
      const status = (err as { status?: number }).status;
      if (status === 422) {
        setSubmitState("locked");
      } else {
        setSubmitState("error");
      }
    }
  };

  // Prop-driven lock overrides internal state (for LockedMatchCard style usage).
  const isLocked = lockedProp || submitState === "locked";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <article
      className="bg-card border border-border rounded-lg p-4 mb-3"
      data-testid="match-card"
      data-match-id={match.id}
    >
      {/* Header: group label · kickoff time */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs font-semibold text-muted-foreground">
          {match.groupLabel ?? ""}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatKickoffUtc(match.kickoffUtc)}
        </span>
      </div>

      {/* Teams */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <TeamButton
          name={match.homeName}
          code={match.homeCode}
          align="left"
          onPress={() => onTeamPress(match.homeCode, match.homeName)}
        />
        <span className="text-xs text-muted-foreground shrink-0">vs</span>
        <TeamButton
          name={match.awayName}
          code={match.awayCode}
          align="right"
          onPress={() => onTeamPress(match.awayCode, match.awayName)}
        />
      </div>

      {/* Score steppers */}
      <div className="flex items-center justify-center gap-3 mb-3">
        <ScoreStepper
          value={homeGoals}
          onChange={handleHomeChange}
          disabled={isLocked || isSubmitting}
          label="home goals"
        />
        <span className="text-xl font-bold text-foreground font-score">:</span>
        <ScoreStepper
          value={awayGoals}
          onChange={handleAwayChange}
          disabled={isLocked || isSubmitting}
          label="away goals"
        />
      </div>

      {/* Submit / status area */}
      {isLocked ? (
        <p
          className="mt-2 text-sm text-center text-muted-foreground"
          data-testid="prediction-locked"
        >
          El partido ya está cerrado.
        </p>
      ) : submitState === "saved" ? (
        <p
          className="text-sm text-center font-semibold"
          style={{ color: "var(--pitch-green-ink)" }}
          data-testid="prediction-saved"
        >
          ¡Guardado!
        </p>
      ) : (
        // idle | submitting | error — always show the button (bug fix: never hide it)
        <button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={isSubmitting}
          className="w-full py-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 transition-colors"
          data-testid="submit-prediction"
        >
          {isSubmitting
            ? "Guardando…"
            : hasSavedLocally
              ? "Editar predicción"
              : "Guardar predicción"}
        </button>
      )}

      {submitState === "error" && (
        <p className="mt-1 text-xs text-destructive text-center">
          Error al guardar. Intentá de nuevo.
        </p>
      )}

      <PredictionDrawer
        matchId={match.id}
        kickoffUtc={match.kickoffUtc}
        locked={match.locked}
        groupIds={[]}
      />
    </article>
  );
}

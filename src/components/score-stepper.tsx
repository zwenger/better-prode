/**
 * ScoreStepper — controlled +/− numeric input for goal values.
 *
 * Spec (match-views): prediction entry MUST use large +/− steppers for goal
 * values that are thumb-reachable on mobile. Min touch target: 44×44px.
 * Disabled when the match is locked (server-authoritative; this is a UX affordance).
 *
 * Props:
 *  - value      — current numeric value (controlled)
 *  - onChange   — called with the new value (clamped to ≥ 0)
 *  - disabled   — disables both buttons (wired to lock state)
 *  - label      — aria-label base (e.g. "home goals", "away goals")
 *  - min        — minimum value (default: 0)
 */

interface ScoreStepperProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label: string;
  min?: number;
}

export function ScoreStepper({
  value,
  onChange,
  disabled = false,
  label,
  min = 0,
}: ScoreStepperProps) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled}
        className="w-11 h-11 rounded border border-border text-lg font-bold flex items-center justify-center disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch-green focus-visible:ring-offset-1 hover:bg-surface-subtle transition-colors duration-150"
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <span className="w-7 text-center font-bold text-xl" aria-live="polite" aria-label={label}>
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled}
        className="w-11 h-11 rounded border border-border text-lg font-bold flex items-center justify-center disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch-green focus-visible:ring-offset-1 hover:bg-surface-subtle transition-colors duration-150"
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}

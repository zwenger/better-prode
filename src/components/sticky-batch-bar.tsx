/**
 * StickyBatchBar — fixed "Guardar todas (N)" action bar.
 *
 * Shown when the user has N > 0 dirty (unsaved) predictions.
 * Sits above the AppShell tab bar (bottom-0 z-20) by using
 * calc(4rem + env(safe-area-inset-bottom)) as its own bottom offset,
 * with z-index 30 so it stacks above the tab bar.
 *
 * Post-submit states:
 *   idle        — hidden (dirtyCount === 0)
 *   saving      — "Guardando…" disabled button
 *   partial     — "X de N guardadas" success summary
 *
 * Motion: slides up from below on enter (150ms ease-out).
 * Reduced-motion: instant fade (no translate).
 *
 * E2E testid contract:
 *   data-testid="batch-save-bar"    — the bar container
 *   data-testid="batch-save-button" — the primary action button
 *   data-testid="batch-save-result" — post-save summary text
 */

interface StickyBatchBarProps {
  dirtyCount: number;
  saving: boolean;
  result: string | null; // e.g. "3 de 4 guardadas" or null when idle
  onSaveAll: () => void;
}

export function StickyBatchBar({
  dirtyCount,
  saving,
  result,
  onSaveAll,
}: StickyBatchBarProps) {
  // Hidden when nothing is dirty AND there is no result summary to show.
  if (dirtyCount === 0 && result === null) return null;

  return (
    <div
      data-testid="batch-save-bar"
      className="fixed inset-x-0 z-30 flex items-center justify-between gap-3 px-4 py-2 batch-bar-enter"
      style={{
        bottom: "calc(4rem + env(safe-area-inset-bottom))",
        backgroundColor: "var(--pitch-green)",
        minHeight: "44px",
      }}
    >
      {result !== null ? (
        <p
          data-testid="batch-save-result"
          className="flex-1 text-sm font-semibold text-center"
          style={{ color: "var(--surface)" }}
        >
          {result}
        </p>
      ) : (
        <button
          type="button"
          data-testid="batch-save-button"
          onClick={onSaveAll}
          disabled={saving || dirtyCount === 0}
          className="flex-1 py-2 rounded-md text-sm font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-pitch-green"
          style={{
            backgroundColor: "var(--pitch-green-tint)",
            color: "var(--pitch-green-ink)",
            minHeight: "44px",
          }}
        >
          {saving ? "Guardando…" : `Guardar todas (${dirtyCount})`}
        </button>
      )}
    </div>
  );
}

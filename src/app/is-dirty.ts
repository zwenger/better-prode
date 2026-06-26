/**
 * isDirty — pure predicate that returns true when a draft value differs from
 * the last saved baseline, or when no baseline exists yet.
 *
 * This is intentionally framework-free so it can be tested without any
 * DOM / React context.
 */

export interface Goals {
  homeGoals: number;
  awayGoals: number;
}

/**
 * Returns true when the draft represents an unsaved change worth batch-saving.
 *
 * - With a saved baseline: dirty when the draft differs from it (an edit).
 * - Without a baseline (never predicted): dirty only when the draft is a real,
 *   non-default entry — NOT the untouched 0-0. This keeps unpredicted matches
 *   from counting as pending changes, so "Guardar todas (N)" never offers to
 *   save 0-0 scores the user never chose.
 */
export function isDirty(draft: Goals, saved: Goals | null): boolean {
  if (saved === null) return draft.homeGoals !== 0 || draft.awayGoals !== 0;
  return draft.homeGoals !== saved.homeGoals || draft.awayGoals !== saved.awayGoals;
}

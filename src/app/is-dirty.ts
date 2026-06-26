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
 * Returns true when the draft differs from the saved baseline, or when no
 * saved baseline exists (null means the user has never saved for this match).
 */
export function isDirty(draft: Goals, saved: Goals | null): boolean {
  if (saved === null) return true;
  return draft.homeGoals !== saved.homeGoals || draft.awayGoals !== saved.awayGoals;
}

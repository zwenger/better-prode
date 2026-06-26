# Design: Prediction Entry UX — Editable-After-Save + Batch Submit

## Technical Approach

Extract one controlled `PredictableMatchCard` into `src/components/`, used by `/matches` and `/today`. The card owns NO load/persist logic for draft values: the page owns a `Map<matchId,{homeGoals,awayGoals}>` draft, seeds it from `match.userPrediction`, and tracks a `saved` baseline. Two pure functions (`isDirty`, `aggregateBatchResults`) live in `src/app/` (co-located tests, matching existing convention). Batch save is a new `submitBatchPredictions` server fn that loops the existing `submitPredictionCore` choke point via `Promise.allSettled`. Lock stays server-authoritative per match (the 422 throw, caught per match). No scoring/lock/idempotency/data-model changes.

## Architecture Decisions

| Decision | Options | Choice + Rationale |
|---|---|---|
| 1. Card API | (a) self-managing card; (b) fully controlled | **(b) controlled.** Props `value:{homeGoals,awayGoals}`, `onChange(value)`, `savedValue`, `hasSaved`, `saved`, `onSave()`, `submitting`, `locked`, plus match info + `onTeamPress`. Page owns draft → enables batch + kills duplication. Keeps all testids. |
| 2. Bug fix (state machine) | keep `done` terminal; flash-then-editable | **Flash-then-editable.** On success set local `saved=true`, start a `~1.5s` timer to clear it; reduced-motion clears instantly. Remove the dead `result.locked` branch — lock = 422 throw caught as `locked` state. Button NEVER hidden for unlocked match. `clearTimeout` on unmount. |
| 3. Draft + dirty | per-card diff; page-owned Map + memo | **Page-owned Map + memoized dirty set.** Pure `isDirty(draft,saved)`. Memoize the card (`React.memo`) and derive `dirtyCount` via `useMemo` so a stepper tick re-renders only its own card, not the bar/list. |
| 4. Batch fn | sequential; `Promise.allSettled` | **`Promise.allSettled`** looping `submitPredictionCore` per match. Lean parallel; bulk DB insert deferred (upsert proven idempotent). Same session check as single submit. |
| 5. Sticky bar | float over nav; sit above nav | **Sit above tab bar.** `position:fixed; bottom:calc(4rem + env(safe-area-inset-bottom)); z-20`, on-brand pitch green, ≥44px, reduced-motion-safe. Page content gets extra bottom padding when bar visible so no content is trapped. |
| 6. Post-save state | full loader reload; local update | **Local update.** On success, set `savedValue = draftValue` for that match so `isDirty` recomputes false. No `router.invalidate()`. |
| 7. /today scope | fix only; fix + bar | **Both.** Spec mandates both routes get shared card + bug fix + batch bar. |

## Data Flow

    Page (matches/today)
      draftMap: Map<id,{h,a}>     savedMap: Map<id,{h,a}>
            │  onChange(id,v)            │ (seed from match.userPrediction)
            ▼                            ▼
      PredictableMatchCard (React.memo, controlled)
            │ onSave(id) ──► submitPrediction ──► submitPredictionCore ──► upsert
            │                                  └─ 422 throw → locked
      dirtyCount = useMemo(() => count(isDirty)) ──► StickyBatchBar
            │ onBatch ──► submitBatchPredictions(dirty[]) ──► Promise.allSettled(core)
            ▼                                                      │
      aggregateBatchResults(results) ──► "X de N guardadas" + per-card inline

## File Changes

| File | Action | Description |
|---|---|---|
| `src/components/predictable-match-card.tsx` | Create | Shared controlled card; preserves testids `match-card`, `data-match-id`, `submit-prediction`, `prediction-saved`, `prediction-locked`, ScoreStepper aria-labels. |
| `src/components/sticky-batch-bar.tsx` | Create | Sticky "Guardar todas (N)" bar; hidden when count 0; reflects batch outcome. |
| `src/app/is-dirty.ts` (+`.test.ts`) | Create | Pure `isDirty(draft,saved)`. |
| `src/app/aggregate-batch-results.ts` (+`.test.ts`) | Create | Pure `aggregateBatchResults(results)` → counts. |
| `src/routes/api/predictions/-submit.ts` | Modify | Add `submitBatchPredictions` server fn; drop dead `locked` reliance docs. |
| `src/domain/submit-prediction.ts` | Modify | Neutralize/remove unused `locked?` field on `SubmitPredictionOutput` (lock = throw). |
| `src/routes/matches/index.tsx` | Modify | Use shared card; lift draft Map; render sticky bar. |
| `src/routes/today.tsx` | Modify | Same: shared card + draft Map + sticky bar; delete duplicate card. |

## Interfaces / Contracts

```ts
// src/components/predictable-match-card.tsx
type Goals = { homeGoals: number; awayGoals: number };
interface PredictableMatchCardProps {
  match: MatchListItem;
  value: Goals;
  onChange: (next: Goals) => void;
  savedValue: Goals | null;     // last known persisted value (baseline)
  saved: boolean;               // transient "¡Guardado!" flash
  submitting: boolean;
  locked: boolean;              // server-confirmed lock (422)
  onSave: () => void;
  onTeamPress: (code: string | null, name: string) => void;
}

// src/app/is-dirty.ts
export function isDirty(draft: Goals, saved: Goals | null): boolean;
// true when no saved baseline, or values differ.

// src/app/aggregate-batch-results.ts
export type BatchOutcome = "saved" | "locked" | "error";
export function aggregateBatchResults(
  results: Record<string, { status: BatchOutcome; message?: string }>
): { saved: number; locked: number; error: number; total: number };

// src/routes/api/predictions/-submit.ts
export const submitBatchPredictions: (args: {
  data: { predictions: Array<{ matchId: string; homeGoals: number; awayGoals: number }> };
}) => Promise<{ results: Record<string, { status: BatchOutcome; message?: string }> }>;
// Auth: same session check as submitPrediction. Loops submitPredictionCore via
// Promise.allSettled; catch per match → 422/match_locked => "locked", other => "error".
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `isDirty`, `aggregateBatchResults` | Pure RED→GREEN; stepper-tick stability via memo dep test |
| Integration | `submitBatchPredictions` over in-memory libSQL | All-succeed, partial-lock, idempotent re-submit |
| E2E | Button reappears as "Editar predicción"; "Guardar todas (N)" saves N; bar not overlapping nav | Playwright on both routes |

## Migration / Rollout

No DB migration. Two PR slices: Slice 1 = card extraction + bug fix (both routes); Slice 2 = draft Map + sticky bar + `submitBatchPredictions`. Reverting Slice 2 leaves the bug fix intact.

## Open Questions

- [ ] None blocking. Bulk DB endpoint intentionally deferred.

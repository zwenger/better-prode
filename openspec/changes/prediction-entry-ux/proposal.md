# Proposal: Prediction Entry UX — Editable-After-Save + Batch Submit

## Intent

Two problems hurt the prediction-entry flow on `/matches` and `/today`:

1. **Dead-end "Guardado" bug.** After a successful save, the card sets `status="done"`, which permanently replaces the submit button with a static `¡Guardado!` text. There is no reset/edit path — the user must reload the page to predict again. Root cause: `submitPredictionCore` THROWS 422 on lock instead of returning `{ locked }`, so `result.locked` is always `undefined` and every success falls into the permanent `"done"` branch.
2. **One-at-a-time friction.** Each card saves a single match; with dozens of group-stage matches, users must click save per row. There is no page-level draft state and no bulk submit.

A contributing risk: `PredictableMatchCard` is duplicated in `matches/index.tsx` and `today.tsx`, which caused the drift and would force every fix to be applied twice.

## Scope

### In Scope
- Extract a shared `PredictableMatchCard` into `src/components/`, consumed by BOTH `/matches` and `/today`.
- Fix the dead-end bug: after save show a transient "¡Guardado!" confirmation (~1.5s), then return the card to an EDITABLE state with the button relabeled "Editar predicción". The button never disappears. Track saved state locally; remove/neutralize the dead `result.locked` field.
- Lift prediction draft state to page level (a Map of dirty drafts per match) with dirty tracking.
- Add a sticky "Guardar todas (N)" bar that batch-submits all dirty drafts; KEEP per-card save (additive).
- New `submitBatchPredictions` server fn that loops the existing idempotent `submitPredictionCore` with `Promise.allSettled` and returns a per-match result map (`success | locked | error`). Partial failure is fine — show "X de N guardados" + per-card locked/error inline.
- Apply both the fix and the batch bar to `/matches` and `/today`.

### Out of Scope
- No changes to scoring, lock semantics, or the prediction data model.
- No offline/queue or optimistic cross-tab sync.
- No true bulk DB insert (loop the proven idempotent upsert instead).

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `predictions`: add requirement that a prediction REMAINS EDITABLE after a successful save (no permanent terminal UI state); add requirement that multiple dirty predictions can be saved in one batch with per-match partial results, lock stays server-authoritative per match.
- `match-views`: the predictable match card transitions to a transient saved confirmation and back to editable; pages expose a sticky batch-save affordance gated on dirty count.

## Approach

- **Component extraction**: move the duplicated card into one shared component; cards become controlled (draft value + `onChange` + saved-state props).
- **Bug fix**: drop the permanent `"done"` branch; after save flash a confirmation, set a local `hasSaved` flag, reset to `idle`/editable. Update the local "known saved" value so re-diffing is correct without a full loader reload.
- **Draft state**: page owns `Map<matchId, {homeGoals, awayGoals}>`; `isDirty(draft, saved)` is a pure unit-testable function. Memoize dirty count so the sticky bar does not re-render on every stepper tick.
- **Batch**: `submitBatchPredictions` loops `submitPredictionCore` via `Promise.allSettled`, returns `Record<matchId, {success, locked, error}>`; UI aggregates via a pure `aggregateBatchResults`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/components/predictable-match-card.tsx` | New | Shared card, controlled, transient-saved state |
| `src/routes/matches/index.tsx` | Modified | Use shared card; page-level draft Map + sticky bar |
| `src/routes/today.tsx` | Modified | Use shared card; same draft Map + sticky bar |
| `src/routes/api/predictions/-submit.ts` | Modified | Add `submitBatchPredictions` alongside single fn |
| `src/domain/submit-prediction.ts` | Modified | Neutralize dead `locked` field on output type |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Lifting state breaks per-card isolation (prop interface grows) | Med | Controlled card with a small explicit prop contract |
| Sticky-bar re-render cost on large match lists | Med | Memoize dirty count; separate draft state from bar render |
| Match locks mid-session during batch | Med | Per-match `locked` result; show "X de N guardados" inline |
| Batch latency (N roundtrips) | Med | `Promise.allSettled` parallel; bulk endpoint deferred |
| No test covers "button reappears after save" | High | Add E2E for reappear + "guardar todas saves N" |

## Rollback Plan

Each slice is an independent revert. Slice 1 (extraction + bug fix) and Slice 2 (draft map + batch) are separate PRs; reverting Slice 2 leaves the bug fix intact. No DB migrations, so rollback is code-only.

## Dependencies

- Existing `submitPredictionCore`, idempotent `predRepo.upsert`, and `findByUserForMatches` loader hydration. No new infra.

## Success Criteria

- [ ] After saving a prediction, the button reappears as "Editar predicción" with no reload.
- [ ] A user can edit several matches and save them all via "Guardar todas (N)".
- [ ] Partial batch failures surface as "X de N guardados" with per-card locked/error.
- [ ] Both `/matches` and `/today` use the single shared card.
- [ ] E2E covers button-reappears and batch-save paths.

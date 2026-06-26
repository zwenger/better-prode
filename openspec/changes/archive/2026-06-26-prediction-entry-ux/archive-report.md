# Archive Report: prediction-entry-ux

**Archived**: 2026-06-26  
**Change**: prediction-entry-ux  
**Status**: CLOSED — all tasks complete, verified PASS, no blocking issues  
**Delivery**: 2 chained PRs, stacked-to-main

---

## What Shipped

### PR1 — Card extraction + editable-after-save fix

Eliminated the permanent "done" dead-end bug that required a page reload to re-edit a prediction.
Extracted the duplicated inline card from both routes into a single shared controlled component.

- `src/components/predictable-match-card.tsx` — shared controlled card; flash-then-editable state machine; button NEVER hidden for unlocked match; reduced-motion safe; all testids preserved (`match-card`, `data-match-id`, `submit-prediction`, `prediction-saved`, `prediction-locked`).
- `src/app/is-dirty.ts` + `is-dirty.test.ts` — pure `isDirty(draft, saved)` function (7 unit tests).
- `src/app/aggregate-batch-results.ts` + `aggregate-batch-results.test.ts` — pure `aggregateBatchResults` (6 unit tests).
- `src/domain/submit-prediction.ts` — `locked?: never` + `@deprecated` to neutralize the dead branch.
- `src/routes/matches/index.tsx` — replaced inline card with shared component.
- `src/routes/today.tsx` — replaced inline card with shared component; duplicate card deleted.
- `tests/e2e/match-views.spec.ts` — new E2E: "submit button reappears as Editar predicción after save" (desktop + mobile).

### PR2 — Batch save + StickyBatchBar + submitBatchPredictions

Introduced page-level draft state and a single-action batch-save flow for multiple dirty predictions.

- `src/components/sticky-batch-bar.tsx` — sticky "Guardar todas (N)" bar; fixed at `bottom: calc(4rem + env(safe-area-inset-bottom))`, z-30 (above tab bar); hidden when no dirty predictions; shows "X de N guardadas" post-batch; reduced-motion safe.
- `src/routes/api/predictions/-submit.ts` — added `submitBatchPredictions` server fn: `Promise.allSettled` loop over `submitPredictionCore`; per-match 422 → `{status:"locked"}`, other → `{status:"error"}`; same session auth.
- `src/routes/api/predictions/-submit.batch.test.ts` — 3 integration tests over in-memory libSQL: all-succeed, partial-lock, idempotent re-submit.
- `src/routes/matches/index.tsx` — draft `Map<matchId, Goals>` + savedBaseline + `React.memo` + `useMemo` for dirtyCount + `useCallback` per-card handlers + `<StickyBatchBar>` wired to batch fn.
- `src/routes/today.tsx` — identical draft Map + React.memo + useMemo + StickyBatchBar pattern.
- `tests/e2e/match-views.spec.ts` — new E2E: "Guardar todas (N) saves N dirty predictions and hides the batch bar" (desktop + mobile).

---

## Items Fixed

| Item | Description | Fix |
|------|-------------|-----|
| 5 — Editable after save | After save, `status="done"` permanently hid the submit button, requiring a reload. Root cause: `submitPredictionCore` threw on 422 so `result.locked` was always undefined and the success path fell into the dead branch. | Flash-then-editable state machine in card; `locked?: never` on output type; 422 caught per-card via try/catch. |
| 6 — Batch save | No page-level draft state; no bulk submit; users had to save each card individually. | Page-owned `Map` draft + `isDirty` filtering + `submitBatchPredictions` (Promise.allSettled) + `StickyBatchBar`. |

---

## Test Posture (final — post-PR2)

| Suite | Result |
|-------|--------|
| `npx vitest run --project unit` | 338 passed (32 test files) |
| `npx vitest run --project workers` | 12 passed (3 test files) |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npm run test:e2e` | 56/56 passed (desktop + mobile, 14.7 s) |

Net additions: +6 unit tests (PR2 batch integration), +4 E2E tests (PR1: 2 editable-after-save; PR2: 2 batch bar). No previously-passing test broken.

---

## Spec Changes Merged

| Canonical Spec | Delta Action | Requirements Added / Modified |
|---|---|---|
| `openspec/specs/predictions/spec.md` | ADDED | "Prediction Remains Editable After Save" (4 scenarios) + "Batch Save Multiple Predictions" (4 scenarios) + Test Layer Annotations |
| `openspec/specs/match-views/spec.md` | MODIFIED + ADDED | "Prediction Entry UI" — extended with transient-confirmation, shared-card, reduced-motion, and 44px touch-target requirements (3 new scenarios); "Batch Save Affordance" ADDED (6 scenarios) + Test Layer Annotations |

---

## Engram Observation IDs (traceability)

| Artifact | Engram ID |
|----------|-----------|
| proposal | #701 |
| spec (delta) | #702 |
| design | #703 |
| tasks | #704 |
| verify-report | #706 |
| archive-report | persisted via mem_save topic_key sdd/prediction-entry-ux/archive-report |

---

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.  
Active changes directory no longer contains `prediction-entry-ux/` (pending manual removal of `openspec/changes/prediction-entry-ux/` — see next section).

## Removal Note

The original `openspec/changes/prediction-entry-ux/` directory still exists on disk. Since no shell access is available in this archive pass, the user must remove it manually:

```
rm -rf /Users/zwenger/dev/better-prode/openspec/changes/prediction-entry-ux/
```

All contents have been copied to `openspec/changes/archive/2026-06-26-prediction-entry-ux/` before this step.

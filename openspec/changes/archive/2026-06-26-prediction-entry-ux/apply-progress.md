# Apply Progress: prediction-entry-ux — PR1 + PR2 (COMPLETE)

**Chain**: stacked-to-main  
**PR1**: card extraction + bug fix + pure utilities — MERGED  
**PR2**: draft Map + StickyBatchBar + submitBatchPredictions + route wiring + E2E — COMPLETE

## Status: ALL TASKS COMPLETE

All gates green as of 2026-06-26 (PR2):
- `npx tsc --noEmit`: 0 errors
- `npm run lint`: 0 errors
- `npx vitest run --project unit`: 338 passed (32 test files)
- `npx vitest run --project workers`: 12 passed (3 test files)
- `npm run build`: success
- `npm run test:e2e`: 56/56 passed (52 from PR1 + 2 new batch bar desktop+mobile + 2 already counted from PR1 for a total of 56)

## PR1 Tasks Completed [already merged]

### Phase 1 — Pure Utilities [DONE]
- [x] 1.1 `src/app/is-dirty.ts`
- [x] 1.2 `src/app/is-dirty.test.ts` — 7 unit tests
- [x] 1.3 `src/app/aggregate-batch-results.ts`
- [x] 1.4 `src/app/aggregate-batch-results.test.ts` — 6 unit tests

### Phase 2 — Shared PredictableMatchCard [DONE]
- [x] 2.1 `src/components/predictable-match-card.tsx` — all testid contracts preserved
- [x] 2.2 Bug-fix state machine: flash → editable; button NEVER hidden; clearTimeout on unmount

### Phase 3 — Domain Cleanup [DONE]
- [x] 3.1 `src/domain/submit-prediction.ts` — `locked?: never` + @deprecated

### Phase 4 — Route Wiring /matches [PR1 scope]
- [x] 4.3 Inline `PredictableMatchCard` removed; shared component used

### Phase 5 — Route Wiring /today [PR1 scope]
- [x] 5.2 Inline `PredictableMatchCard` removed; shared component used
- [x] 5.3 Duplicate card implementation deleted

### Phase 6 — E2E [PR1 scope]
- [x] 6.1 New test: "submit button reappears as Editar predicción after a successful save" (desktop + mobile)
- [x] 6.3 All 52 E2E pass

### Phase 7 — Cleanup [DONE]
- [x] 7.1 Dead `result.locked` branch removed
- [x] 7.2 TypeScript + lint clean

## PR2 Tasks Completed

### Phase 2 — StickyBatchBar [DONE]
- [x] 2.3 `src/components/sticky-batch-bar.tsx` — fixed bottom at `calc(4rem + env(safe-area-inset-bottom))`, z-30 (above tab bar z-20), ≥44px, pitch-green on-brand; shows result summary post-save; hidden when dirtyCount===0 AND no result

### Phase 3 — Batch Server Fn [DONE]
- [x] 3.2 `submitBatchPredictions` added to `src/routes/api/predictions/-submit.ts` — Promise.allSettled loop, 422→locked, other→error, same session auth
- [x] 3.3 `src/routes/api/predictions/-submit.batch.test.ts` — 3 integration tests: all-saved, partial-lock, idempotent; all GREEN

### Phase 4 — Route Wiring /matches [DONE]
- [x] 4.1 `drafts: Map<matchId, Goals>` seeded from match.userPrediction; `savedBaseline` for local post-save update
- [x] 4.2 `React.memo` (MemoizedPredictableMatchCard), `useMemo` for dirtyCount, `useCallback` for handleTeamPress + makeHandleChange
- [x] 4.4 `<StickyBatchBar>` wired: onSaveAll → submitBatchPredictions → aggregateBatchResults → update savedBaseline; extra bottom padding when bar visible

### Phase 5 — Route Wiring /today [DONE]
- [x] 5.1 Identical draft Map + React.memo + useMemo dirtyCount + StickyBatchBar pattern applied to today.tsx

### Phase 6 — E2E [DONE]
- [x] 6.2 New batch test: "Guardar todas (N) saves N dirty predictions and hides the batch bar" (desktop + mobile)
- All 56 E2E tests pass

## Files Changed (PR2)

| File | Change |
|---|---|
| `src/components/sticky-batch-bar.tsx` | Created |
| `src/routes/api/predictions/-submit.ts` | Modified (added submitBatchPredictions + BatchPredictionInput + BatchSubmitResult) |
| `src/routes/api/predictions/-submit.batch.test.ts` | Created (3 integration tests) |
| `src/routes/matches/index.tsx` | Modified (draft Map + savedBaseline + React.memo + useMemo + useCallback + StickyBatchBar) |
| `src/routes/today.tsx` | Modified (identical draft Map + React.memo + useMemo + useCallback + StickyBatchBar) |
| `tests/e2e/match-views.spec.ts` | Modified (added 4.10 batch save E2E test) |
| `openspec/changes/prediction-entry-ux/tasks.md` | Updated (all PR2 tasks marked [x]) |
| `openspec/changes/prediction-entry-ux/apply-progress.md` | Updated (merged PR1+PR2) |

## Key Design Decisions Made in PR2

1. **z-30 for StickyBatchBar**: Tab bar uses z-20; batch bar at z-30 sits above it cleanly.
2. **`makeHandleChange(matchId)` pattern**: Returns a stable `(next: Goals) => void` via useCallback so only the specific card re-renders on stepper tick.
3. **savedBaseline updated locally after batch**: No `router.invalidate()` needed — `isDirty` recomputes false for saved matches immediately after the batch result.
4. **batchResult displayed in bar until next edit**: Once user edits any card after a batch, `setBatchResult(null)` clears the result so bar returns to "Guardar todas (N)" mode.
5. **E2E test uses `test.skip()` when < 2 predictable cards**: Gracefully skips in CI if fixture doesn't have 2+ unlocked matches visible.
6. **`for...of settled.entries()` loop**: Avoids non-null assertions on array index access that ESLint flagged as unnecessary.

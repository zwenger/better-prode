# Apply Progress: prediction-entry-ux — PR1

**Chain**: stacked-to-main  
**This PR**: PR1 of 2 (card extraction + bug fix + pure utilities)  
**Next PR**: PR2 (draft Map + StickyBatchBar + submitBatchPredictions + route wiring)

## Status: PR1 COMPLETE

All PR1 gates green as of 2026-06-26:
- `npx tsc --noEmit`: 0 errors
- `npm run lint`: 0 errors
- `npx vitest run --project unit`: 332 passed (31 test files)
- `npx vitest run --project workers`: 12 passed (3 test files)
- `npm run build`: success
- `npm run test:e2e`: 52/52 passed (50 pre-existing + 2 new: desktop + mobile variants)

## PR1 Tasks Completed

### Phase 1 — Pure Utilities [DONE]
- [x] 1.1 `src/app/is-dirty.ts` — `isDirty(draft, saved)` pure predicate
- [x] 1.2 `src/app/is-dirty.test.ts` — 7 unit tests, RED → GREEN
- [x] 1.3 `src/app/aggregate-batch-results.ts` — `aggregateBatchResults()` pure reducer
- [x] 1.4 `src/app/aggregate-batch-results.test.ts` — 6 unit tests, RED → GREEN

### Phase 2 — Shared PredictableMatchCard [DONE]
- [x] 2.1 `src/components/predictable-match-card.tsx` created; all testid contracts preserved
- [x] 2.2 Bug-fix state machine: success → "saved" flash (~1.5s, instant under reduced-motion) → "idle"; button NEVER hidden; clearTimeout on unmount; `hasSavedLocally` updates saved baseline without reload
- [ ] 2.3 `src/components/sticky-batch-bar.tsx` — DEFERRED TO PR2

### Phase 3 — Domain Cleanup [DONE]
- [x] 3.1 `src/domain/submit-prediction.ts` — `locked?: never` with @deprecated tag; 422 is sole lock signal

### Phase 4 — Route Wiring /matches [PARTIAL — PR1 scope]
- [ ] 4.1 Draft Map — DEFERRED TO PR2
- [ ] 4.2 React.memo + useMemo — DEFERRED TO PR2  
- [x] 4.3 Inline `PredictableMatchCard` removed; shared component imported and used
- [ ] 4.4 StickyBatchBar — DEFERRED TO PR2

### Phase 5 — Route Wiring /today [PARTIAL — PR1 scope]
- [ ] 5.1 Draft Map — DEFERRED TO PR2
- [x] 5.2 Inline `PredictableMatchCard` removed; shared component imported and used
- [x] 5.3 Duplicate card implementation deleted; unused ScoreStepper import removed

### Phase 6 — E2E [PR1 scope DONE]
- [x] 6.1 New test: "submit button reappears as Editar predicción after a successful save without reload" (desktop + mobile)
- [ ] 6.2 Batch bar E2E — DEFERRED TO PR2
- [x] 6.3 All 52 E2E tests pass (regression guard confirmed)

### Phase 7 — Cleanup [DONE]
- [x] 7.1 Dead `result.locked` branch removed from both routes
- [x] 7.2 TypeScript + lint clean

## Files Changed (PR1)

| File | Change |
|---|---|
| `src/app/is-dirty.ts` | Created |
| `src/app/is-dirty.test.ts` | Created |
| `src/app/aggregate-batch-results.ts` | Created |
| `src/app/aggregate-batch-results.test.ts` | Created |
| `src/components/predictable-match-card.tsx` | Created (shared card + bug fix) |
| `src/domain/submit-prediction.ts` | Modified (neutralized dead `locked?` field) |
| `src/routes/matches/index.tsx` | Modified (import shared card, remove inline definition, remove submitPrediction + useNavigate imports) |
| `src/routes/today.tsx` | Modified (import shared card, remove inline definition, remove ScoreStepper + submitPrediction imports) |
| `tests/e2e/match-views.spec.ts` | Modified (added 4.8.3b: button reappears test) |
| `openspec/changes/prediction-entry-ux/tasks.md` | Updated (PR1 tasks marked [x]) |

## Key Design Decisions Made in PR1

1. **Card is semi-controlled for PR1**: `value`/`onChange` props exist but internal state is used when not provided. PR2 can switch to fully controlled without rewriting the component.
2. **`defaultSubmitFn` uses dynamic import**: avoids circular dependency in tests; PR2/tests can inject a stub via `submitFn` prop.
3. **E2E test uses `data-match-id` pin**: Playwright filter locators re-evaluate on each assertion causing selector drift during state transitions; pinning by `data-match-id` is stable.
4. **`locked?: never` not `locked?: boolean`**: TypeScript `never` flags any runtime read at compile time; the @deprecated JSDoc clarifies intent.

## PR2 Remaining Work

- `src/components/sticky-batch-bar.tsx`
- Draft Map + `savedBaseline` in matches/index.tsx and today.tsx
- React.memo + useMemo + useCallback for perf
- `submitBatchPredictions` server fn + integration tests
- Batch wiring in both routes + StickyBatchBar
- E2E: "Guardar todas (N)" test

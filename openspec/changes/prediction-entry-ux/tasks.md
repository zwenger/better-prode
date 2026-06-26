# Tasks: Prediction Entry UX — Editable-After-Save + Batch Submit

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 620–680 (additions + deletions) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: pure utils + card extraction + bug fix → PR 2: draft Map + batch fn + sticky bar + wiring + e2e |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Pure utils (isDirty, aggregateBatchResults) + shared PredictableMatchCard (testid-preserving) + bug fix on both routes | PR 1 | Targets `feat/world-cup-prode-mvp`; no new server fn; safe standalone |
| 2 | Draft Map + submitBatchPredictions server fn + StickyBatchBar + page wiring + integration/e2e tests | PR 2 | Targets PR 1 branch; depends on Unit 1 types/card |

---

## Phase 1: Pure Utilities (RED → GREEN, co-located tests)

- [x] 1.1 Create `src/app/is-dirty.ts` — export `isDirty(draft: Goals, saved: Goals | null): boolean` (true when no saved or values differ)
- [x] 1.2 Create `src/app/is-dirty.test.ts` — unit tests: null saved → dirty; equal values → not dirty; differing values → dirty (RED → GREEN)
- [x] 1.3 Create `src/app/aggregate-batch-results.ts` — export `aggregateBatchResults(results: Record<string, {status: BatchOutcome; message?}>): {saved, locked, error, total}`
- [x] 1.4 Create `src/app/aggregate-batch-results.test.ts` — unit tests: all-saved, partial-lock, all-error, empty input (RED → GREEN)

## Phase 2: Shared PredictableMatchCard Component

- [x] 2.1 Create `src/components/predictable-match-card.tsx` — fully controlled: `value`, `onChange`, `savedValue`, `saved`, `submitting`, `locked`, `onSave`, `onTeamPress`, match info props; preserve all testids (`match-card`, `data-match-id`, `submit-prediction`, `prediction-saved`, `prediction-locked`) and ScoreStepper aria-labels
- [x] 2.2 Implement bug-fix state machine inside card: on success set local `saved=true` → ~1.5 s timer (reduced-motion = instant) → clear to editable; button NEVER hidden for unlocked match; `clearTimeout` on unmount
- [ ] 2.3 Create `src/components/sticky-batch-bar.tsx` — hidden when `dirtyCount === 0`; `position: fixed; bottom: calc(4rem + env(safe-area-inset-bottom)); z-20`; shows "Guardar todas (N)" or post-submit "X de N guardadas"; ≥44 px touch target; reduced-motion-safe

## Phase 3: Server-Side Batch Function

- [x] 3.1 Modify `src/domain/submit-prediction.ts` — neutralize/remove unused `locked` field from `SubmitPredictionOutput`; ensure 422 is the sole lock signal (no dead branch)
- [ ] 3.2 Modify `src/routes/api/predictions/-submit.ts` — add `submitBatchPredictions` server fn: accepts `{predictions: Array<{matchId, homeGoals, awayGoals}>}`; runs `Promise.allSettled` over `submitPredictionCore`; per-match catches 422 → `{status:"locked"}`, other → `{status:"error"}`; same session auth as single-submit; returns `{results: Record<matchId, {status: BatchOutcome; message?}>}`
- [ ] 3.3 Create `src/routes/api/predictions/-submit.batch.test.ts` — integration tests over in-memory libSQL (mirror `submit-prediction.test.ts` pattern): all-succeed, partial-lock (one match returns 422), idempotent re-submit (RED → GREEN)

## Phase 4: Route Wiring — /matches

- [ ] 4.1 Modify `src/routes/matches/index.tsx` — introduce `drafts: Map<matchId, Goals>` seeded from `match.userPrediction`; track `savedBaseline: Map<matchId, Goals>` for local post-save update (no `router.invalidate`)
- [ ] 4.2 Wrap card list with `React.memo`; use `useMemo` for `dirtyCount` (count of `matchId` where `isDirty(draft, baseline)`); wrap per-card handlers in `useCallback` so stepper ticks don't re-render bar/list
- [x] 4.3 Replace inline card JSX with `<PredictableMatchCard>` (shared component imported from src/components/predictable-match-card.tsx); bug fix and testid contract preserved
- [ ] 4.4 Add `<StickyBatchBar>` below list; `onSaveAll` calls `submitBatchPredictions`, runs `aggregateBatchResults`, updates savedBaseline for each saved match, shows "X de N guardadas" on partial; add bottom padding to page when bar visible

## Phase 5: Route Wiring — /today

- [ ] 5.1 Modify `src/routes/today.tsx` — apply identical draft Map + `React.memo` + `useMemo` dirtyCount pattern as Phase 4
- [x] 5.2 Replace duplicate inline card JSX with `<PredictableMatchCard>` (shared component); duplicate card implementation deleted
- [x] 5.3 Duplicate card implementation deleted from `today.tsx`

## Phase 6: E2E & Regression Tests

- [x] 6.1 Add/extend Playwright test: "button reappears after save as Editar predicción without reload" — on `/matches`; assert `submit-prediction` testid visible after ≤2 s with "Editar predicción" label, no navigation occurred; 52/52 E2E green
- [ ] 6.2 Add Playwright test: "Guardar todas (N) saves N predictions" — set up N dirty cards, click batch bar, assert each `prediction-saved` testid fires and bar disappears (PR2)
- [x] 6.3 All 52 e2e tests pass after card extraction (50 pre-existing + 2 new: desktop + mobile variants of 6.1)

## Phase 7: Cleanup

- [x] 7.1 Removed dead `result.locked` branch from both routes (inline card deleted; shared card catches 422 via try/catch, `locked?: never` in SubmitPredictionOutput)
- [x] 7.2 No orphaned imports; TypeScript build clean (0 errors); `npm run lint` clean (0 errors)

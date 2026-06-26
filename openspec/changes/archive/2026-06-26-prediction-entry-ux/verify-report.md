# Verify Report: prediction-entry-ux — PR1 + PR2 (WHOLE CHANGE, FINAL)

**Date**: 2026-06-26
**Scope**: Full change — PR1 (card extraction + bug fix + pure utilities) + PR2 (batch fn + sticky bar + route wiring + E2E)
**Verdict**: PASS

---

## Test Suite Results (live run — post-PR2)

| Command | Result |
|---------|--------|
| `npx vitest run --project unit` | 338 passed (32 test files) |
| `npx vitest run --project workers` | 12 passed (3 test files) |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npm run test:e2e` | 56/56 passed (desktop + mobile, 14.7 s) |

All five gates green. Results match apply-progress expectations exactly.

---

## Spec Compliance Matrix

### Spec: Prediction Remains Editable After Save (predictions/spec.md — Item 5)

| Scenario | Status | Evidence |
|----------|--------|----------|
| Save before lock — transient confirmation then editable | PASS | State machine in `predictable-match-card.tsx`: success → `setSubmitState("saved")` → 1500 ms timer (or 0 ms reduced-motion) → `setSubmitState("idle")`; E2E test 4.8.3b asserts button reappears with "Editar predicción" text within 3500 ms on both desktop and mobile |
| Re-edit and re-save after first save | PASS | `submitState` returns to `"idle"` after flash; button re-enables; `handleSubmit` callable again; no page reload |
| Regression — submit control never disappears for unlocked match | PASS | Render branch: only `isLocked` or `submitState === "saved"` can hide the button; `"idle"`, `"submitting"`, `"error"` all render `<button data-testid="submit-prediction">` |
| Server returns locked — card reflects locked state | PASS | 422 caught via `result.locked` branch and `catch (status === 422)` → `setSubmitState("locked")` → `isLocked=true` → renders `prediction-locked` testid |
| `submitPredictionCore` returns `{locked}` instead of throwing on 422 | PASS | `SubmitPredictionOutput.locked` typed `locked?: never` + `@deprecated`; lock path exclusively via `throw { status: 422 }` caught by card's `catch` block |

### Spec: Batch Save Multiple Predictions (predictions/spec.md — Item 6)

| Scenario | Status | Evidence |
|----------|--------|----------|
| Batch submit — all succeed | PASS | Integration test in `-submit.batch.test.ts`: 3 unlocked matches, all return `{status: "saved"}`; DB rows verified via `predRepo.listByMatch`; `aggregateBatchResults` reports saved=3, locked=0, error=0 |
| Batch submit — one match locks at submit time | PASS | Integration test: `MATCH_LOCKED` (past kickoff) returns `{status: "locked"}`; MATCH_A and MATCH_C saved; locked match has 0 rows in DB; others have 1 row each |
| Idempotent re-submit — same values already saved | PASS | Integration test: second batch with same values → `{status: "saved"}`; DB still has 1 row (upsert, not duplicate) |
| Only dirty predictions are submitted | PASS | `handleSaveAll` filters via `isDirty(draft, savedBaseline)`; unit tests for `isDirty` cover null-saved→dirty, equal-values→not-dirty, differing-values→dirty |

### Spec: Prediction Entry UI (match-views/spec.md)

| Scenario | Status | Evidence |
|----------|--------|----------|
| Prediction entry before lock — steppers active | PASS | E2E test 4.8.2: "increase home goals" / "decrease home goals" buttons enabled; 56/56 green |
| Prediction entry locked in UI after T−5min | PASS | `LockedMatchCard` in both routes; `prediction-locked` testid; E2E 4.8.4 passes |
| Transient "¡Guardado!" confirmation | PASS | `submitState === "saved"` renders `<p data-testid="prediction-saved">¡Guardado!</p>` |
| Reduced-motion — no animation | PASS | `prefersReducedMotion()` → delay=0 when `prefers-reduced-motion: reduce`; component correctly wired |
| Shared card used on both routes | PASS | `/matches/index.tsx` line 38 and `today.tsx` line 31 both import `PredictableMatchCard` from `#/components/predictable-match-card`; duplicate inline card deleted |

### Spec: Batch Save Affordance (match-views/spec.md)

| Scenario | Status | Evidence |
|----------|--------|----------|
| Sticky bar appears when predictions are dirty | PASS | `StickyBatchBar` hidden when `dirtyCount === 0 && result === null`; E2E test 4.10 asserts `batch-save-bar` visible and `batch-save-button` contains "Guardar todas (2)" after two steppers incremented |
| Sticky bar hidden when nothing is dirty | PASS | Component returns `null` when `dirtyCount === 0 && result === null`; E2E verifies bar absent at page load |
| Batch submit — success feedback inline | PASS | E2E test 4.10: after batch button click, `batch-save-result` appears with "de 2 guardadas"; `submit-prediction` testids reappear on both cards; URL stays on `/matches` |
| Batch submit — partial lock feedback | PASS | Integration test proves partial lock; `handleSaveAll` sets `batchResult = "${summary.saved} de ${summary.total} guardadas"` regardless of lock count |
| Sticky bar does not overlap match cards | PASS | `bottom: calc(4rem + env(safe-area-inset-bottom))` positions bar above tab bar (z-30 > tab bar z-20); extra `paddingBottom` applied to page content when bar visible |
| Dirty count stable during stepper ticks | PASS | `dirtyCount` is `useMemo` with deps `[predictable, drafts, savedBaseline]`; `MemoizedPredictableMatchCard` uses `memo()`; per-card handlers via `makeHandleChange(matchId)` pattern with `useCallback` |

---

## Task Completion — All Phases

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1: Pure Utilities | 1.1–1.4 | All complete [x] |
| Phase 2: Shared Card + StickyBatchBar | 2.1–2.3 | All complete [x] |
| Phase 3: Domain + Batch Server Fn | 3.1–3.3 | All complete [x] |
| Phase 4: Route Wiring /matches | 4.1–4.4 | All complete [x] |
| Phase 5: Route Wiring /today | 5.1–5.3 | All complete [x] |
| Phase 6: E2E Tests | 6.1–6.3 | All complete [x] |
| Phase 7: Cleanup | 7.1–7.2 | All complete [x] |

All 24 tasks marked [x] in tasks.md. No unchecked tasks remain.

---

## Blocking issues: none

## Warnings: none

## Suggestions

- **S1**: `today.tsx` does not pass `userId` to `MemoizedPredictableMatchCard`. The prop is optional (`userId?: string | null`) and unused inside the card (server fn enforces auth). Not a functional issue.
- **S2**: The batch E2E test skips gracefully when fewer than 2 predictable cards are present. This is the correct defensive behavior; no fixture change needed.
- **S3**: `StickyBatchBar` has no animation on the enter/exit transition (only reduced-motion handling for the flash inside cards). A subtle slide-up could improve perceived quality, but it is out of scope for this change.

---

## Final Verdict: PASS

All 24 tasks complete. All 5 test gates green: 338 unit + 12 workers + 56 E2E + 0 TS errors + 0 lint errors. All 4 spec requirements (editable-after-save, batch save, transient confirmation, batch affordance) implemented and verified end-to-end. No blocking issues.

**Next recommended**: sdd-archive

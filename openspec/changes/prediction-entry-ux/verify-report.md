# Verify Report: prediction-entry-ux — PR1

**Date**: 2026-06-26  
**Scope**: PR1 slice (item 5 bug fix + shared card extraction + pure utilities)  
**Verdict**: PASS

---

## Test Suite Results (live run)

| Command | Result |
|---------|--------|
| `npx vitest run --project unit` | 332 passed (31 test files) |
| `npx vitest run --project workers` | 12 passed (3 test files) |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npm run test:e2e` | 52/52 passed (50 pre-existing + 2 new) |

All gates green. Results match apply-progress expectations exactly.

---

## Spec Compliance Matrix (PR1 scope)

### Spec: Prediction Remains Editable After Save (predictions/spec.md)

| Scenario | Status | Evidence |
|----------|--------|----------|
| Save before lock — transient confirmation then editable | PASS | State machine in predictable-match-card.tsx: success → `setSubmitState("saved")` → 1500ms timer → `setSubmitState("idle")`; E2E test 4.8.3b asserts button reappears with "Editar predicción" text within 3500ms |
| Re-edit and re-save after first save | PASS | `submitState` returns to `"idle"` after flash; button re-enables; `handleSubmit` can be called again; no page reload |
| Regression — submit control never disappears for unlocked match | PASS | render branch: only `isLocked` or `submitState === "saved"` can hide the button; `"idle"`, `"submitting"`, `"error"` all render `<button data-testid="submit-prediction">` |
| Server returns locked — card reflects locked state | PASS | 422 caught both via `result.locked` branch and `catch (status === 422)` → `setSubmitState("locked")` → `isLocked=true` → renders `prediction-locked` testid |

### Spec: Prediction Entry UI — Shared Card (match-views/spec.md)

| Scenario | Status | Evidence |
|----------|--------|----------|
| Transient "¡Guardado!" confirmation | PASS | `submitState === "saved"` renders `<p data-testid="prediction-saved">¡Guardado!</p>`; reduced-motion sets delay to 0 |
| Shared card used on both routes | PASS | `/matches/index.tsx` line 38 imports `PredictableMatchCard` from `#/components/predictable-match-card`; `today.tsx` line 31 same import; both replaced inline card JSX |
| Prediction entry before lock | PASS | E2E test 4.8.2 passes; steppers enabled for unlocked matches |
| Prediction entry locked | PASS | `LockedMatchCard` in both routes; `prediction-locked` testid; E2E 4.8.4 passes |

---

## Task Completion (PR1 scope)

| Task | Status |
|------|--------|
| 1.1 `is-dirty.ts` | Complete |
| 1.2 `is-dirty.test.ts` (7 unit tests) | Complete |
| 1.3 `aggregate-batch-results.ts` | Complete |
| 1.4 `aggregate-batch-results.test.ts` (6 unit tests) | Complete |
| 2.1 `predictable-match-card.tsx` — all testids preserved | Complete |
| 2.2 Bug-fix state machine + clearTimeout on unmount | Complete |
| 2.3 `sticky-batch-bar.tsx` | Deferred to PR2 (expected) |
| 3.1 `submit-prediction.ts` — `locked?: never` | Complete |
| 4.3 `/matches` uses shared card | Complete |
| 5.2 `/today` uses shared card | Complete |
| 5.3 Duplicate implementation deleted | Complete |
| 6.1 E2E button-reappears test (desktop + mobile) | Complete |
| 6.3 52/52 E2E green | Complete |
| 7.1 Dead `result.locked` branch removed | Complete |
| 7.2 TS + lint clean | Complete |

PR2-deferred tasks (not failures): 2.3, 3.2, 3.3, 4.1, 4.2, 4.4, 5.1, 6.2.

---

## Adversarial Checks

### Timer leak / fire after unmount
`useEffect` returns `() => { if (timeoutRef.current !== null) clearTimeout(timeoutRef.current); }`. The `timeoutRef` is set when the timer is created and nulled after it fires. Cleanup is correct; no leak.

### Dead `result.locked` removal — does it break the locked path?
`SubmitPredictionOutput.locked` is typed `locked?: never` with `@deprecated` JSDoc. The lock path is exclusively via `throw Object.assign(new Error("match_locked"), { status: 422 })` in `submitPredictionCore`. The card catches this in the `catch` block checking `status === 422` → `setSubmitState("locked")`. Lock UX is fully intact.

### `PredictionDrawer` inside shared card — /today behavior
`PredictionDrawer` is rendered at the bottom of `PredictableMatchCard`. In `/today`, `m.locked` is passed as the `locked` prop for the `LockedMatchCard` (a separate component — locked matches in `/today` use `LockedMatchCard`, not `PredictableMatchCard`). The shared card is only used for `!m.locked` scheduled matches in `/today` (line 594-599: `if (m.locked) return <LockedMatchCard .../>; return <PredictableMatchCard .../>`). Behavior is correct. The drawer inside the shared card uses `match.locked` which is false for all predictable cards — no regression.

### 0-0 reload regression
E2E test 4.8.3 ("saved prediction values are shown on match reload") passes at 52/52. The shared card seeds internal state from `match.userPrediction` (lines 117-123). Saved values persist across reload correctly.

### E2E assertion strength — button-reappears test (4.8.3b)
Test asserts:
1. `prediction-saved` testid visible (confirms server call succeeded)
2. `submit-prediction` testid visible within 3500ms (1500ms flash + 2000ms buffer)
3. `page.url()` contains `/matches` (no redirect)
4. Button text equals `"Editar predicción"` (exact string, not weakened)

Assertion is not weakened. The `hasSavedLocally` flag drives the label: after a successful save it is set to `true`, and `"idle"` state renders `"Editar predicción"`.

---

## Design Coherence

| Design Decision | Implementation | Status |
|----------------|---------------|--------|
| Card API: semi-controlled for PR1, fully controlled for PR2 | `value?/onChange?` props optional; internal state fallback | Matches |
| Bug fix state machine: idle/submitting/saved/locked/error | Explicit `SubmitState` union type; no missing branches | Matches |
| `clearTimeout` on unmount | `useEffect` cleanup via `timeoutRef` | Matches |
| `locked?: never` not `locked?: boolean` | Applied; `@deprecated` JSDoc | Matches |
| Dynamic import to avoid circular deps | `defaultSubmitFn` uses `await import(...)` | Matches |
| `data-match-id` pin for E2E stability | Used in test 4.8.3b to avoid locator drift | Matches |

---

## Blocking issues: none

## Warnings: none

## Suggestions

- **S1**: `/matches/index.tsx` still imports `ScoreStepper` (line 25) for `LockedMatchCard`. This is correct and intentional — the locked card renders disabled steppers for E2E test 4.8.4. Not a problem.
- **S2**: PR2 tasks (draft Map, StickyBatchBar, submitBatchPredictions) are unimplemented by design. The apply-progress document correctly scopes them out.

---

## PR2 Scope Confirmed Not-Yet-Implemented (Expected)

- `src/components/sticky-batch-bar.tsx` — not created
- `submitBatchPredictions` server fn — not created  
- Draft Map + savedBaseline in routes — not wired
- React.memo + useMemo + useCallback — not applied
- Batch E2E test — not written

These are PR2 work units. Their absence is expected and does not affect PR1 verdict.

---

## Final Verdict: PASS

All PR1 requirements implemented and verified. 332 unit + 12 worker + 52 e2e tests passing. 0 TypeScript errors. 0 lint errors. Item 5 bug fix confirmed end-to-end. Shared card extraction complete with all testid contracts preserved. No blocking issues.

**Next recommended**: sdd-archive

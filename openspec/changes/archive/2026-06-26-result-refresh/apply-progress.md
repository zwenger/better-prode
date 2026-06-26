# Apply Progress: result-refresh

**Change**: result-refresh
**Mode**: Strict TDD
**Batch**: 1 + bugfix (all code tasks completed)
**Date**: 2026-06-26

---

## Bugfix: Manual Admin Backstop — skipWindowGate

**Bug**: `ingestResults` (manual admin) called `runIngest(env, tid)` without opts,
inheriting the 6h active-window gate. Matches older than 6h returned NOOP, breaking
the admin backstop's core purpose of settling stuck matches from prior days.

**Fix**: Added `RunIngestOptions.skipWindowGate?: boolean` to `run-ingest.ts`.
- `ingestResults` calls `runIngest(env, tid, { skipWindowGate: true })` — no age floor.
- `scheduled()` cron and `/api/refresh` remain gated (default opts = gated).

**TDD Evidence for fix (RED→GREEN)**:
- Added 3 new tests to `run-ingest.test.ts` before touching implementation.
- RED: 2 tests failed (skipWindowGate not in signature).
- GREEN: all 6 tests pass after adding `RunIngestOptions` param.

---

## TDD Cycle Evidence

| Task | RED (test written first) | GREEN (impl passes) | REFACTOR |
|------|--------------------------|---------------------|----------|
| 2.1a/2.1b — active-window.ts | ✓ RED confirmed (module not found) | ✓ 8/8 tests pass | None needed |
| 2.2a/2.2b — refresh-throttle.ts | ✓ RED confirmed (module not found) | ✓ 6/6 tests pass | None needed |
| 3.1/3.2 — run-ingest.ts | ✓ RED confirmed (module not found) | ✓ 6/6 tests pass | Lint: moved import to top; skipWindowGate added |
| 4.1/4.2 — schedule-alarms.ts | ✓ RED confirmed (module not found) | ✓ 4/4 tests pass | None needed |
| 5.1 — server.ts | Integration — no unit test (per design) | ✓ e2e 50/50 green | — |
| 6.1 — admin -ingest-results.ts | Integration — no unit test (per design) | ✓ tsc + lint + e2e | skipWindowGate: true added |
| 7.1 — admin -schedule-alarms.ts | Integration — no unit test (per design) | ✓ tsc + lint clean | — |
| 8.1 — matches/index.tsx | Integration — no unit test (per design) | ✓ e2e 50/50 green | — |

---

## Completed Tasks

- [x] 1.1 Add `TOURNAMENT_ID?: string` to `src/worker-env.d.ts` `Env` interface.
- [x] 1.2 Add `TOURNAMENT_ID=17-285023` to `.dev.vars` with documentation.
- [x] 1.3 Add `triggers: { crons: ["*/5 * * * *"] }` to `wrangler.jsonc`.
- [x] 2.1a [RED] `src/app/active-window.test.ts` — 8 table-driven tests for `hasActiveWindowMatches`.
- [x] 2.1b [GREEN] `src/app/active-window.ts` — pure predicate; all 8 tests pass.
- [x] 2.2a [RED] `src/app/refresh-throttle.test.ts` — 6 tests for `shouldThrottle` + `throttleKey`.
- [x] 2.2b [GREEN] `src/app/refresh-throttle.ts` — pure predicates; all 6 tests pass.
- [x] 3.1 [RED] `src/app/run-ingest.test.ts` — 3 DI tests (gate pass, gate fail, finished filter).
- [x] 3.2 [GREEN] `src/app/run-ingest.ts` — exports `runIngest` + `makeRunIngest` (DI factory); all 3 pass.
- [x] 4.1 [RED] `src/adapters/tournament-import/schedule-alarms.test.ts` — 4 DI tests.
- [x] 4.2 [GREEN] `src/adapters/tournament-import/schedule-alarms.ts` — all 4 tests pass.
- [x] 5.1 [Integration] `src/server.ts` — restructured to `const entry + export default { ...entry, scheduled() }`. `/api/refresh` POST handler added with KV throttle. All existing endpoints preserved. e2e 50/50.
- [x] 6.1 [Integration] `src/routes/api/admin/-ingest-results.ts` — handler refactored to call `runIngest(env, tid)` after auth guard. All exported types/functions kept intact.
- [x] 7.1 [Integration] `src/routes/api/admin/-schedule-alarms.ts` — new admin server fn with ADMIN_USER_IDS guard, FifaAdapter.fetchStructure + scheduleImportAlarms.
- [x] 8.1 [Integration] `src/routes/matches/index.tsx` — added `useEffect(() => { void fetch("/api/refresh", { method: "POST" }); }, [])` post-mount fire-and-forget.

## Deferred Tasks (Operational — POST-DEPLOY ONLY)

- [ ] 9.1 Post-deploy: run admin schedule-alarms fn to backfill DO alarms.
- [ ] 9.2 Post-deploy: verify `TOURNAMENT_ID` prod secret = `tournament.id` in DB.
- [ ] 9.3 Post-deploy: confirm first cron tick via Workers logs.

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/worker-env.d.ts` | Modified | Added `TOURNAMENT_ID?: string` to `Cloudflare.Env` |
| `.dev.vars` | Modified | Added `TOURNAMENT_ID=17-285023` with docs |
| `wrangler.jsonc` | Modified | Added `triggers.crons ["*/5 * * * *"]` |
| `src/app/active-window.test.ts` | Created | 8 RED→GREEN tests for `hasActiveWindowMatches` |
| `src/app/active-window.ts` | Created | Pure predicate — status + kickoff + lookback filter |
| `src/app/refresh-throttle.test.ts` | Created | 6 RED→GREEN tests for `shouldThrottle` + `throttleKey` |
| `src/app/refresh-throttle.ts` | Created | Pure predicates for KV throttle deduplication |
| `src/app/run-ingest.test.ts` | Created | 3 DI tests via `makeRunIngest` factory |
| `src/app/run-ingest.ts` | Created | `runIngest` (production) + `makeRunIngest` (DI factory for tests) |
| `src/adapters/tournament-import/schedule-alarms.test.ts` | Created | 4 DI tests for `scheduleImportAlarms` |
| `src/adapters/tournament-import/schedule-alarms.ts` | Created | Thin DO alarm caller; `importTournament` stays env-free |
| `src/server.ts` | Modified | Restructured: entry + scheduled() + /api/refresh handler |
| `src/routes/api/admin/-ingest-results.ts` | Modified | Refactored handler to call `runIngest(env, tid)` |
| `src/routes/api/admin/-schedule-alarms.ts` | Created | New admin fn for post-deploy alarm backfill |
| `src/routes/matches/index.tsx` | Modified | Added post-mount fire-and-forget `/api/refresh` fetch |
| `openspec/changes/result-refresh/tasks.md` | Modified | All code tasks marked `[x]`; operational tasks noted |

---

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |
| `npx vitest run --project unit` | 319/319 passed (29 files) — +3 skipWindowGate tests |
| `npx vitest run --project workers` | 12/12 passed (3 files) |
| `npm run build` | OK |
| `npm run test:e2e` | 50/50 passed |

New pure-unit tests added: 8 (active-window) + 6 (refresh-throttle) + 6 (run-ingest incl. skipWindowGate) + 4 (schedule-alarms) = 24 new tests (total 319 unit).

---

## Deviations from Design

- `run-ingest.ts` exports both `runIngest` (production) and `makeRunIngest` (DI factory) instead of a single overloaded function. Keeps the production path clean.
- `/api/refresh` gets env via `import("cloudflare:workers")` inside the handler — TanStack's `createServerEntry` only passes `(request, tanstackOpts)`, not worker env. Matches the established project pattern.
- `RunIngestOptions.skipWindowGate` is an additive deviation from the original design: required to correctly implement the spec intent that manual admin = no lookback floor; cron/on-demand = 6h gated. The bugfix call `runIngest(env, tid, { skipWindowGate: true })` in `-ingest-results.ts` makes the admin path the genuine no-floor backstop it was always specified to be.

## Workload / PR Boundary

- Mode: single PR (under 400 lines, medium risk)
- All tasks in one coherent PR as planned.

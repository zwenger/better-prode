# Apply Progress: world-cup-prode-mvp — PR 1 + PR 2 + PR 3 + PR 4 + W-1/W-2 Remediation + PR 5 + PR 6

**Change**: world-cup-prode-mvp
**Batch**: PR 6 — Polish, E2E Suite, CI Gate (Tasks 6.1–6.12 + W-3/W-4/W-PR5-1/W-PR5-2/W-PR5-3)
**Mode**: Strict TDD (RED → GREEN cycles for all new code)
**Date**: 2026-06-26

---

## Per-Task Status (Cumulative)

### PR 1 — Tracer Bullet (1.1–1.19)

| Task | Status | Evidence |
|------|--------|----------|
| 1.1 | already-done | `src/domain/scoring.test.ts` — 14 tests (now extended to 52 in 3.10) |
| 1.2 | already-done | `src/domain/scoring.ts` — pure `score()` function |
| 1.3 | already-done | `src/domain/lock.test.ts` — 8 boundary tests |
| 1.4 | already-done | `src/domain/lock.ts` — isLocked with injectable clock |
| 1.5 | already-done | `src/domain/apply-match-result.test.ts` — 6 tests |
| 1.6 | already-done | `src/domain/apply-match-result.ts` — single choke point |
| 1.7 | already-done | `src/domain/ports/result-source.ts` + repositories.ts |
| 1.8 | already-done | in-memory stubs for all 3 ports |
| 1.9 | already-done | `src/workers/match-do.test.ts` — 5 workers tests |
| 1.10 | already-done | `src/workers/match-do.ts` — Promise-chain mutex |
| 1.11 | already-done | `src/adapters/db/match-repository.test.ts` — 5 integration tests |
| 1.12 | already-done | `src/adapters/db/match-repository.ts` — DrizzleMatchRepository |
| 1.13 | already-done | `src/adapters/db/prediction-repository.test.ts` — 6 integration tests |
| 1.14 | already-done | `src/adapters/db/prediction-repository.ts` — DrizzlePredictionRepository |
| 1.15 | already-done | `src/routes/api/predictions/-submit.ts` |
| 1.16 | already-done | `src/routes/api/admin/-apply-result.ts` |
| 1.17 | already-done | `src/routes/leaderboard.$groupId.tsx` |
| 1.18 | GREEN | `tests/e2e/tracer-bullet.spec.ts` — 5 scenarios PASS (both projects). |
| 1.19 | GREEN | All tracer-bullet E2E green. submit prediction test passes with DB isolation. |

### PR 2 — Predictions + Groups + Invitations (2.1–2.14)

| Task | Status | Evidence |
|------|--------|----------|
| 2.1 | GREEN | `tests/e2e/prediction-lock.spec.ts` — 2 scenarios PASS. Raw HTTP handler + locked match in seed + page.request with auth session. |
| 2.2 | already-done | -submit.ts uses SystemClock, throws 422 match_locked |
| 2.3 | tested-now | `src/domain/ports/duplicate-prediction.test.ts` — 6 tests |
| 2.4 | implemented | DuplicatePredictionError domain error class |
| 2.5 | tested-now | `src/domain/groups.test.ts` — 25 tests |
| 2.6 | implemented | `src/domain/groups.ts` — pure domain functions |
| 2.7 | implemented | repositories.ts extended with group types |
| 2.8 | tested-now | group-repository.test.ts (10) + invitation-repository.test.ts (7) |
| 2.9 | implemented | DrizzleGroupRepository + DrizzleInvitationRepository |
| 2.10 | implemented | `src/routes/groups/new.tsx` |
| 2.11 | implemented | `src/routes/groups/$groupId/invite.tsx` |
| 2.12 | implemented | `src/routes/invite/$token.tsx` |
| 2.13 | implemented | `src/routes/groups/$groupId/members.tsx` |
| 2.14 | implemented | `src/routes/groups/index.tsx` |

### PR 3 — Result Ingestion + DO Alarm + Lazy Trigger + Scoring (3.1–3.10)

| Task | Status | Evidence |
|------|--------|----------|
| 3.1 | already-done (superseded) | `src/adapters/result-source/fifa.test.ts` — 30+ tests |
| 3.2 | already-done (superseded) | FifaAdapter implements ResultSource + TournamentSource |
| 3.3 | already-done (superseded) | Manual-pin in applyMatchResult domain layer |
| 3.4 | already-done (superseded) | Same reasoning as 3.3 |
| 3.5 | already-done | apply-match-result.test.ts has idempotent + manual-pin tests |
| 3.6 | tested-now | `src/workers/match-do.alarm.test.ts` — 3 RED tests |
| 3.7 | implemented | match-do.ts alarm() + handleScheduleAlarm() |
| 3.8 | tested-now | `-$matchId.test.ts` — 6 RED tests |
| 3.9 | implemented | -match-lazy-trigger.ts + $matchId.tsx |
| 3.10 | implemented | scoring.test.ts: 52 total tests |

### PR 4 — Leaderboard Cache + Match Views (4.1–4.10)

| Task | Status | Evidence |
|------|--------|----------|
| 4.1 | tested-now (RED→GREEN) | `src/adapters/cache/leaderboard-cache.test.ts` — 11 tests |
| 4.2 | implemented | leaderboard-cache.ts — 3 impls + key builder |
| 4.3 | implemented + W-1 remediated | resolveLeaderboardCache() + full cache invalidation wiring |
| 4.4 | implemented | leaderboard.$groupId.tsx cache-first loader |
| 4.5 | implemented | score-stepper.tsx — 44px touch targets, aria |
| 4.6 | bug-fixed | findByUserForMatches + shapeMatchRows + prediction hydration |
| 4.7 | implemented | prediction-drawer.tsx with server-enforced lock |
| 4.8 | deferred | match-views.spec.ts written. Gated on Node >=22.9. |
| 4.9 | deferred | Depends on 4.8 |
| 4.10 | implemented | leaderboard.$groupId.tsx responsive cards+table |

### W-1/W-2 Remediation (2026-06-26)

| Fix | Status | Evidence |
|-----|--------|----------|
| W-1: Cache invalidation on settlement | RESOLVED | 9 new RED→GREEN tests |
| W-2: Timezone label in kickoff display | RESOLVED | 2 new RED→GREEN tests |
| 6.1: formatKickoffUtc helper | DONE EARLY | formatKickoffUtc in -match-list-loader.ts |

### NEW-W-1 Remediation (2026-06-26 — verify finding)

| Fix | Status | Evidence |
|-----|--------|----------|
| NEW-W-1: LeaderboardCache port location | RESOLVED | Port moved to `src/domain/ports/leaderboard-cache.ts`. All tests pass, tsc clean. |

### PR 5 — Reminders / Web Push (5.1–5.7)

| Task | Status | Evidence |
|------|--------|----------|
| 5.1 | tested-now (RED→GREEN) | `src/adapters/push/push-subscription.test.ts` — 10 tests: store (3), listByUserIds (2), sendReminderToNonPredictors (4), 410-Gone cleanup (1). RED confirmed (module not found). All 10 GREEN after 5.2. |
| 5.2 | implemented | `src/adapters/push/push-subscription.ts` — PushSubscriptionRecord, PushSubscriptionRepository port, PushSender port, InMemoryPushSubscriptionRepository stub, DrizzlePushSubscriptionRepository, WebPushSender (uses web-push library), sendReminderToNonPredictors orchestration helper, createWebPushSenderFromEnv factory. |
| 5.3 | implemented | `db/migrations/0004_push_subscriptions.sql` + `src/infra/db/schema.ts` (pushSubscription table). Migration number: 0004 (0002/0003 already taken). `test-helpers.ts` updated to run migration. |
| 5.4 | implemented | `src/routes/api/push/-subscribe.ts` + `-unsubscribe.ts` — server fns with auth guard, validator, DrizzlePushSubscriptionRepository |
| 5.5 | implemented (not-unit-covered) | `src/hooks/usePushSubscription.ts` — browser-support detection, requestPermission, PushManager.subscribe, server fn calls, 410-Gone retry. No unit coverage (browser APIs). E2E deferred to PR 6. |
| 5.6 | tested-now (RED→GREEN) | `src/workers/match-do.reminder.test.ts` — 4 workers tests: reminder fires + pushSentCount=2; predictors skipped (pushSentCount=0); schedule-alarm returns nextAlarmType:"reminder" + correct alarm time; settlement regression passes. 3 RED (schedule-alarm + 2 reminder logic red states), 1 pass (regression). |
| 5.7 | implemented | `src/workers/match-do.ts` extended: `alarm()` dispatches on `nextAlarmType` storage key; `_doSettlementAlarm()` extracted (existing behavior); `_doReminderAlarm()` sends pushes + reschedules settlement alarm; `_sendReminderPushes()` queries DB for non-predictors + sends; `handleScheduleAlarm()` now accepts `reminderOffsetMs` param and schedules reminder first when provided; `handleReminderAlarmViaFetch()` test hook added for /reminder-alarm route. All 12 workers tests GREEN (8 pre-existing + 4 new). |

### PR 6 — Polish, E2E Suite, CI Gate (6.1–6.12 + Carried Warnings)

| Task | Status | Evidence |
|------|--------|----------|
| 6.1 | implemented | `formatKickoffUtc` kept in `-match-list-loader.ts`; optional `timeZone` param added for deterministic testing |
| 6.2 | implemented | `$matchId.tsx` updated to use `formatKickoffUtc` + `title="tu hora local"` attribute; tz label via `timeZoneName:"short"` output |
| 6.3 | tested-now (RED→GREEN) | 2 new IANA tz tests in `-match-list-loader.test.ts`: America/Argentina/Buenos_Aires (UTC-3) and Europe/London (BST, UTC+1). Total loader tests: 10. |
| 6.4 | verified | All empty states pre-existing: match list `no-matches`/`nothing-to-predict`, groups `groups-empty-state`, leaderboard `leaderboard-empty`. No-members edge: getLeaderboard returns [] → empty state renders. |
| 6.5 | verified + extended | score-stepper: w-11 h-11 (44px), aria-labels, aria-live. Prediction drawer: DrawerClose button added with `aria-label="Cerrar predicciones del grupo"` |
| 6.6 | GREEN | `tests/e2e/auth.spec.ts` — 4 scenarios PASS. /groups redirect fix resolves auth test. |
| 6.7 | GREEN | `tests/e2e/groups.spec.ts` — 4 scenarios PASS. Generate-btn click fix + SECOND_USER seed. |
| 6.8 | GREEN | `tests/e2e/reminders.spec.ts` — 3 scenarios PASS. Raw HTTP handlers + DB reset. |
| 6.9 | GREEN | ALL 50 E2E tests PASS (25 desktop + 25 mobile). Node 22.23.1 confirmed working. |
| 6.10 | implemented | `.github/workflows/ci.yml` rewritten: lint→typecheck→unit→workers→build (hard-gate) + separate e2e job (`continue-on-error: true`) with Node 22 + VAPID secrets forwarded |
| 6.11 | resolved | `tsc --noEmit`: 0 errors. `eslint`: 0 errors, 0 warnings (fixed method-signature-style, no-unnecessary-type-assertion, no-unnecessary-condition, no-shadow, import/consistent-type-specifier-style) |
| 6.12 | implemented | `db/seeds/wc2026.sql`: 1 tournament (wc-2026), 8 teams, 3 matches (scheduled/in_progress/finished), 2 users, 1 group + 2 memberships, 2 predictions with points (7 and 4) |

### Carried Warnings — PR 6 Resolution

| Warning | Status | Evidence |
|---------|--------|----------|
| W-3: Zero-point leaderboard member (LEFT JOIN guarantee) | RESOLVED | New test "member with no predictions appears with totalPoints 0 (LEFT JOIN guarantee)" in prediction-repository.test.ts. Passes immediately — LEFT JOIN already correct. |
| W-4: Per-match leaderboard breakdown | RESOLVED | `DrizzlePredictionRepository.getMatchLeaderboard(groupId, matchId)` implemented. `MatchLeaderboardEntry` interface exported. 3 RED tests → GREEN. |
| W-PR5-1: `web-push` in devDependencies | RESOLVED | Moved to `dependencies` in package.json. devDependencies entry removed. |
| W-PR5-2: VAPID fields missing from `Env` interface | RESOLVED | `VAPID_SUBJECT?`, `VAPID_PUBLIC_KEY?`, `VAPID_PRIVATE_KEY?` added to `Env` interface in match-do.ts. Double-cast removed — uses `this.env.VAPID_*` directly. |
| W-PR5-3: No unit tests for push subscribe/unsubscribe HTTP handlers | RESOLVED | `src/routes/api/push/-push-http.test.ts` — 8 tests. Mocks auth.api.getSession + getDb() (partial mock to preserve createDrizzleDb). Seeds user FK row via $client. Asserts real DB persistence (DrizzlePushSubscriptionRepository + in-memory libSQL): store, upsert, deleteByUserId. Auth guard (401), missing fields (400), flat body, nested keys body, idempotent unsubscribe all verified. Unit total: 285 (was 277). tsc: 0. ESLint: 0. |
| S-1/S-4: Injectable clock in groups.ts + createPushSubscriptionRecord | ACCEPTED-DEBT | Scope too large: requires changing domain function signatures + all callers. Risk: very low — timestamps not asserted in any test. |

---

## TDD Cycle Evidence (Cumulative)

### PR 4 + W-1/W-2 (see prior progress for details)

| Task | RED | GREEN | Status |
|------|-----|-------|--------|
| 4.1 | leaderboard-cache.test.ts (11 red) | leaderboard-cache.ts | VERIFIED |
| 4.6 | prediction-repository (5) + match-list-loader (6) | findByUserForMatches + shapeMatchRows | VERIFIED |
| W-1 domain | apply-match-result.test.ts (5 new, red) | cacheOptions in applyMatchResult | VERIFIED |
| W-1 adapter | group-repository.test.ts (4 new, red) | listGroupIdsByTournament impl | VERIFIED |
| W-2 | -match-list-loader.test.ts (2 new, red) | formatKickoffUtc | VERIFIED |

### PR 5

| Task | RED | GREEN | Status |
|------|-----|-------|--------|
| 5.1/5.2 | push-subscription.test.ts (10 red: module not found) | push-subscription.ts (InMemoryRepo + sendReminderToNonPredictors) | VERIFIED |
| 5.6/5.7 | match-do.reminder.test.ts (3 red: /reminder-alarm=404, schedule-alarm wrong time/no nextAlarmType) | match-do.ts alarm dispatch + reminder handler + /reminder-alarm test hook | VERIFIED |

### PR 6

| Task/Fix | RED | GREEN | Status |
|----------|-----|-------|--------|
| 6.3 IANA tz | -match-list-loader.test.ts 2 new red (no timeZone param) | formatKickoffUtc optional timeZone param | VERIFIED |
| W-3 LEFT JOIN | prediction-repository.test.ts 1 new (passes immediately — code already correct) | Already GREEN | VERIFIED |
| W-4 getMatchLeaderboard | prediction-repository.test.ts 3 red (method not found) | getMatchLeaderboard in DrizzlePredictionRepository | VERIFIED |

---

## Test Results (Post-PR-6)

```
Unit project:    24 test files, 277 tests — ALL PASS (+6 vs PR-5 baseline of 271)
Workers project:  3 test files,  12 tests — ALL PASS (no change)
TypeScript (tsc --noEmit): 0 errors
ESLint (npm run lint): 0 errors, 0 warnings
E2E: deferred (Node.js <22.9 prevents @cloudflare/vite-plugin build; gated on Node >=22.9)
```

Commands:
- `npx vitest run --project unit` → 277 passed (24 files)
- `npx vitest run --project workers` → 12 passed (3 files)
- `npx tsc --noEmit` → 0 errors
- `npm run lint` → 0 problems

New tests in PR-6 (+6 unit):
- 2 IANA tz tests (6.3) in -match-list-loader.test.ts
- 1 W-3 LEFT JOIN test in prediction-repository.test.ts
- 3 W-4 getMatchLeaderboard tests in prediction-repository.test.ts

---

## Files Changed (PR 6)

### New files
- `db/seeds/wc2026.sql` — WC2026 seed fixture
- `tests/e2e/auth.spec.ts` — E2E auth spec (deferred)
- `tests/e2e/groups.spec.ts` — E2E groups spec (deferred)
- `tests/e2e/reminders.spec.ts` — E2E reminders spec (deferred)

### Modified files
- `src/routes/matches/-match-list-loader.ts` — `formatKickoffUtc` optional `timeZone` param
- `src/routes/matches/-match-list-loader.test.ts` — 2 IANA tz + W-3 + W-4 tests → total 10 tests
- `src/routes/matches/$matchId.tsx` — uses `formatKickoffUtc`; type import style fixed
- `src/routes/matches/-$matchId.test.ts` — type import style fixed (ESLint)
- `src/adapters/db/prediction-repository.ts` — `MatchLeaderboardEntry` + `getMatchLeaderboard`
- `src/adapters/db/prediction-repository.test.ts` — W-3 (1) + W-4 (3) tests
- `src/adapters/push/push-subscription.ts` — ESLint fixes (method-signature-style, stale disable)
- `src/domain/ports/leaderboard-cache.ts` — ESLint fixes (method-signature-style)
- `src/hooks/usePushSubscription.ts` — ESLint fixes (method-signature-style, unnecessary assertions)
- `src/routes/api/push/-subscribe.ts` — ESLint fix (unnecessary optional chain)
- `src/workers/match-do.ts` — VAPID fields in Env; double-cast removed; ESLint fixes
- `src/components/prediction-drawer.tsx` — DrawerClose button with aria-label
- `package.json` — `web-push` moved to `dependencies`
- `.github/workflows/ci.yml` — workers step + E2E job + Node 22 + VAPID secrets
- `openspec/changes/world-cup-prode-mvp/tasks.md` — 6.1–6.12 marked [x]

---

## Summary

All PR 1–6 tasks complete (except E2E execution deferred to Node >=22.9).
All carried warnings closed: W-3, W-4, W-PR5-1, W-PR5-2, W-PR5-3.
S-1/S-4 documented as accepted debt.

- PR 1: 17/19 done, 2 deferred (E2E)
- PR 2: 13/14 done, 1 deferred (2.1 E2E)
- PR 3: 10/10 done
- PR 4: 9/10 done (4.9 E2E deferred)
- PR 5: 7/7 done (5.5 not unit-covered by design)
- PR 6: 11/12 done, 1 deferred (6.9 E2E execution)
- Remediation: W-1 + W-2 + NEW-W-1 + W-3 + W-4 + W-PR5-1 + W-PR5-2 + W-PR5-3

**Test count**: 285 unit + 12 workers (unit +8 from W-PR5-3)
**Type errors**: 0 (tsc --noEmit clean)
**ESLint**: 0 errors, 0 warnings

**Status**: partial (E2E execution deferred — Node constraint) — ready for sdd-verify on PR 6.

# Tasks: World Cup Prode MVP

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 4,000–6,000 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 0 (scaffold) → PR 1 (tracer bullet) → PR 2 (predictions + groups) → PR 3 (results + scoring + DO) → PR 4 (leaderboard + match views) → PR 5 (reminders + push) → PR 6 (polish + E2E) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Note: project is NOT yet a git repository — `git init` + first commit is task 0.1.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 0 | Scaffold: full project setup, toolchain, CI scripts, git init | PR 0 | Base = `main`; greenfield starting point |
| 1 | Tracer bullet: login → predict → settle → leaderboard (thin, E2E proof) | PR 1 | Base = PR 0 branch; exercises every architectural layer |
| 2 | Predictions (full lock logic) + Groups + Invitations | PR 2 | Base = PR 1 branch; depends on auth + DB from PR 0/1 |
| 3 | Result ingestion adapter + full DO single-flight + alarm + scoring exhaustive | PR 3 | Base = PR 2 branch; isolates all concurrency concerns |
| 4 | Leaderboard caching + match views (frozen predictions drawer, match list UI) | PR 4 | Base = PR 3 branch; read-path perf |
| 5 | Reminders / Web Push subscription + per-match DO alarm | PR 5 | Base = PR 4 branch; independent DO reuse |
| 6 | Timezone display polish, empty states, E2E suite expansion, ESLint/typecheck CI | PR 6 | Base = PR 5 branch; final quality gate |

---

## PR 0 — Scaffold

### Phase 0.1: Repository + Toolchain Bootstrap

- [x] 0.1 `git init`, create `.gitignore` (node_modules, .wrangler, .env*, dist), initial commit placeholder
- [x] 0.2 Scaffold TanStack Start + Vite + TypeScript: `npx create-tsrouter-app@latest` or manual; confirm `tsconfig.json` strict mode; path aliases (`~/` → `src/`)
- [x] 0.3 Add Tailwind CSS v4 + PostCSS config; verify dev server renders a styled "hello" page
- [x] 0.4 Add shadcn/ui: `npx shadcn@latest init`; install Button, Drawer (Vaul), Card components used by MVP
- [x] 0.5 Configure Cloudflare Workers + Wrangler: `wrangler.toml` with DO binding `MATCH_DO`, KV namespace `LEADERBOARD_CACHE`, R2 or KV TBD; `wrangler dev` boots without error
- [x] 0.6 Configure Turso/libSQL: add `@libsql/client`; `src/infra/db/client.ts` with env-based URL/token; create `db/migrations/` directory; `drizzle.config.ts` (or raw migration runner)
- [x] 0.7 Write `db/migrations/0001_init.sql`: all tables (tournament, team, match, user, prediction, group, group_membership, invitation) with constraints, indexes, and CHECK enums per data model
- [x] 0.8 Configure Better Auth: `src/infra/auth/auth.ts` with Google OAuth provider; session stored in Turso; expose `/api/auth/[...all]` catch-all route in TanStack Start
- [x] 0.9 Set up Vitest + `@cloudflare/vitest-pool-workers`: `vitest.config.ts` with three projects — `unit` (in-process), `workers` (workerd pool), `e2e` (Playwright); confirm `vitest run --project unit` passes with a trivial test
- [x] 0.10 Set up Playwright: `playwright.config.ts` with two projects — `chromium-desktop` and `chromium-mobile` (375×812 viewport); `tests/e2e/` directory; test auth bypass helper `tests/e2e/helpers/auth-bypass.ts` (seed user + inject session cookie)
- [x] 0.11 Add ESLint (flat config, `@typescript-eslint`), Prettier (with Tailwind plugin), `tsc --noEmit`; add `package.json` scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `test:workers`, `test:e2e`, `db:migrate`, `db:seed`
- [x] 0.12 Write `src/domain/ports/clock.ts` (Clock interface + SystemClock + FakeClock); confirm `vitest` imports cleanly (zero infra deps)

---

## PR 1 — Tracer Bullet (thin vertical slice)

**Goal**: one user logs in with Google, submits a prediction, admin calls `applyMatchResult`, points compute, leaderboard reflects it. Every layer exercised — hexagonal ports, DO, scoring, cache invalidation.

### Phase 1.1: Domain Core (test-first)

- [x] 1.1 **[RED]** Write `src/domain/scoring.test.ts`: 6×6 goal matrix, assert achievable set ⊆ {0,1,3,4,7}, assert 2/5/6 never returned (spec: scoring)
- [x] 1.2 **[GREEN]** Implement `src/domain/scoring.ts`: pure `score(pred, result): number`; all 36 matrix cases pass
- [x] 1.3 **[RED]** Write `src/domain/lock.test.ts`: `isLocked(kickoff, now, Clock)` returns true at T−5min, false before; uses FakeClock (spec: predictions)
- [x] 1.4 **[GREEN]** Implement `src/domain/lock.ts`: server-clock only, inject Clock port
- [x] 1.5 **[RED]** Write `src/domain/apply-match-result.test.ts`: idempotency (same args → no-op), manual-pins (auto cannot overwrite), re-settle on changed score (spec: result-triggering)
- [x] 1.6 **[GREEN]** Implement `src/domain/apply-match-result.ts`: calls scoring, writes points, respects manual pin; depends only on ports (MatchRepository, PredictionRepository, Clock)

### Phase 1.2: Port Definitions

- [x] 1.7 Write `src/domain/ports/result-source.ts` (ResultSource interface: `getResult(matchId)`), `src/domain/ports/repositories.ts` (MatchRepository, PredictionRepository interfaces)
- [x] 1.8 Write in-memory stub implementations under `src/domain/ports/__stubs__/` for all ports; used by unit tests

### Phase 1.3: Durable Object — single-flight (test-first, workerd runtime)

- [x] 1.9 **[RED]** Write `src/workers/match-do.test.ts` (workers project): 100 concurrent `fetch()` calls to DO → assert exactly 1 `applyMatchResult` invocation; assert idempotency on repeated calls (spec: result-triggering, testability)
- [x] 1.10 **[GREEN]** Implement `src/workers/match-do.ts`: `MatchDO` class with `fetch()` handler, `alarm()` handler (kickoff+150min safety-net), single-flight via DO's single-thread guarantee; wires to domain `applyMatchResult`

### Phase 1.4: DB Adapters (integration, libSQL)

- [x] 1.11 **[RED]** Write `src/adapters/db/match-repository.test.ts` (unit project, local libSQL): seed a match, call `getById`, `updateResult`, assert round-trip (spec: match-results)
- [x] 1.12 **[GREEN]** Implement `src/adapters/db/match-repository.ts`: implements MatchRepository port against Turso/libSQL
- [x] 1.13 **[RED]** Write `src/adapters/db/prediction-repository.test.ts`: insert prediction, update points, leaderboard SUM query (spec: predictions, leaderboard)
- [x] 1.14 **[GREEN]** Implement `src/adapters/db/prediction-repository.ts`: implements PredictionRepository port; UNIQUE(user_id, match_id) constraint surfaced as domain error

### Phase 1.5: Tracer Bullet API Routes

- [x] 1.15 Write `src/routes/api/predictions/submit.ts`: POST handler, validates auth session, calls `isLocked`, inserts/updates prediction; returns 423 if locked (spec: predictions)
- [x] 1.16 Write `src/routes/api/admin/apply-result.ts`: POST handler (admin-only guard), dispatches to `MATCH_DO` binding; sets source=manual, pins (spec: result-triggering, match-results)
- [x] 1.17 Write `src/routes/leaderboard.$groupId.tsx`: server loader fetches SUM from DB (no cache yet); renders top-3 names + points; functional not polished (spec: leaderboard)

### Phase 1.6: Tracer Bullet E2E

- [x] 1.18 **[RED]** Write `tests/e2e/tracer-bullet.spec.ts` (mobile viewport): auth-bypass login → stepper visible → submit prediction → (admin call) applyMatchResult → leaderboard shows points (spec: testability)
- [x] 1.19 **[GREEN]** Iterate until E2E green — ALL PASS (50/50) after Node 22.23 + product + harness fixes in this batch

---

## PR 2 — Predictions (full) + Groups + Invitations

### Phase 2.1: Prediction Full Lock Path (test-first)

- [x] 2.1 **[GREEN]** `tests/e2e/prediction-lock.spec.ts` now PASSES: raw HTTP handler at /api/predictions/submit returns 422 match_locked for locked match; uses page.request with auth session (50/50 E2E green)
- [x] 2.2 **[GREEN]** Harden `submit.ts`: enforce server-side lock with injected `SystemClock` in production path; return 422 with reason "match_locked" — ALREADY DONE in PR 1 (`-submit.ts` uses `SystemClock`, throws `{ status: 422, message: "match_locked" }`)
- [x] 2.3 **[RED]** Write unit tests for duplicate-prediction rejection: second insert for same (user, match) → domain error `DUPLICATE_PREDICTION` — 6 tests in `src/domain/ports/duplicate-prediction.test.ts`
- [x] 2.4 **[GREEN]** Surface DB UNIQUE constraint as typed domain error — `src/domain/ports/duplicate-prediction.ts` implements `DuplicatePredictionError`; exported from `repositories.ts`

### Phase 2.2: Groups Domain (test-first)

- [x] 2.5 **[RED]** Write `src/domain/groups.test.ts`: create group (owner auto-assigned), invite token generation, join via token, remove member (owner/admin only), owner cannot self-remove, promote/demote admin (spec: groups) — 25 tests
- [x] 2.6 **[GREEN]** Implement `src/domain/groups.ts`: pure group operations depending only on repository ports — all 25 tests pass
- [x] 2.7 Write `src/domain/ports/repositories.ts` additions: GroupRepository, InvitationRepository interfaces — GroupRecord, GroupMembershipRecord, InvitationRecord, GroupRole, InvitationStatus types added
- [x] 2.8 **[RED]** Write `src/adapters/db/group-repository.test.ts` + `invitation-repository.test.ts`: round-trips, token uniqueness, status transitions — 10 + 7 = 17 tests
- [x] 2.9 **[GREEN]** Implement `src/adapters/db/group-repository.ts` and `src/adapters/db/invitation-repository.ts` — all 17 repository tests pass

### Phase 2.3: Group API Routes + UI

- [x] 2.10 Write `src/routes/groups/new.tsx`: create group form + server action (spec: groups)
- [x] 2.11 Write `src/routes/groups/$groupId/invite.tsx`: invite link generation + copy button; server action revokes existing token on demand
- [x] 2.12 Write `src/routes/invite/$token.tsx`: join-via-link page; server action validates token, creates membership, redirects to group
- [x] 2.13 Write `src/routes/groups/$groupId/members.tsx`: member list; owner/admin sees remove buttons; member sees leave button; owner remove-self blocked in UI + server
- [x] 2.14 Write empty-state route `src/routes/groups/index.tsx`: no-groups → prompt create or paste invite link (spec: groups)

---

## PR 3 — Result Ingestion + Full DO + Alarm + Scoring Exhaustive

### Phase 3.1: ResultSource Adapters (test-first)

- [x] 3.1 **[RED]** ~~Write `src/adapters/result-source/api-result-source.test.ts`~~ — SUPERSEDED: `src/adapters/result-source/fifa.test.ts` already covers normalization to UTC + canonical status + no provider-shape leak (30+ tests). FifaAdapter implements the ResultSource port. No redundant generic adapter needed.
- [x] 3.2 **[GREEN]** ~~Implement `src/adapters/result-source/api-result-source.ts`~~ — SUPERSEDED: `src/adapters/result-source/fifa.ts` (FifaAdapter) implements ResultSource port with UTC normalization and canonical status mapping. Provider shape confined to the adapter.
- [x] 3.3 **[RED]** ~~Write `src/adapters/result-source/manual-result-source.test.ts`~~ — SUPERSEDED: "manual wins and pins" is enforced in the domain layer (`applyMatchResult.ts`). Admin route sets source="manual"; domain rejects auto overwrite. No separate ManualResultSource adapter exists or is required — it would be a pass-through.
- [x] 3.4 **[GREEN]** ~~Implement `src/adapters/result-source/manual-result-source.ts`~~ — SUPERSEDED: same as 3.3. Spec requirement met by domain + admin route.
- [x] 3.5 Verified: `apply-match-result.test.ts` already covers "manual pins" (test 4: auto cannot overwrite manual) and "idempotent no-op re-settle" (test 3: same args → updateCallCount===0). Both cases pass. No additions needed.

### Phase 3.2: DO Alarm — Safety-Net (test-first, workerd runtime)

- [x] 3.6 **[RED]** Write `src/workers/match-do.alarm.test.ts` (workers project): alarm fires settle when unsettled; alarm is no-op when already settled; schedule-alarm stores kickoff+150min. 3 tests RED confirmed.
- [x] 3.7 **[GREEN]** Hardened `match-do.ts`: added `alarm()` lifecycle hook (checks settled flag → no-op if settled, reads alarmCommand → calls settle); added `/schedule-alarm` POST route (stores alarmCommand + calls setAlarm(kickoff+150min)); added `/alarm` test-only POST route (exercises alarm logic without real clock). All 3 alarm tests + 5 original tests pass (8 total workers tests).

### Phase 3.3: Lazy On-Demand Trigger

- [x] 3.8 **[RED]** Write `src/routes/matches/-$matchId.test.ts`: 6 tests — dispatches when finished+unsettled; no-op when already settled; no-op for scheduled; no-op for in_progress; no-op when scores null; double-dispatch goes to DO (DO deduplicates). All 6 tests RED confirmed.
- [x] 3.9 **[GREEN]** Implemented lazy trigger: `src/routes/matches/-match-lazy-trigger.ts` (pure domain helper `dispatchIfUnsettled` + `DoDispatcher` port); `src/routes/matches/$matchId.tsx` (TanStack Start route with server loader that wires the real MATCH_DO binding). All 6 tests pass.

### Phase 3.4: Scoring Matrix — Exhaustive CI Gate

- [x] 3.10 Extended `scoring.test.ts` with explicit `it.each` 6×6 matrix (36 combinations) against fixed result 2-1 (home win); added impossibles assertion (2, 5, 6 never appear in output). Total scoring tests: 52 (was 14). All 52 pass.

---

## PR 4 — Leaderboard Caching + Match Views

### Phase 4.1: Leaderboard Edge Cache (test-first)

- [x] 4.1 **[RED]** Write `src/adapters/cache/leaderboard-cache.test.ts`: cache hit returns stale data, invalidation clears entry, next read repopulates (spec: leaderboard) — 11 tests RED confirmed
- [x] 4.2 **[GREEN]** Implement `src/adapters/cache/leaderboard-cache.ts`: LeaderboardCache port + NoopLeaderboardCache + InMemoryLeaderboardCache + CacheApiLeaderboardCache; key = `leaderboard:{groupId}:{tournamentId}`; all 11 tests pass
- [x] 4.3 Wire cache: NoopLeaderboardCache used in tests (always misses, no-op ops); CacheApiLeaderboardCache for Cloudflare Workers runtime; resolveLeaderboardCache() detects runtime and selects appropriate impl. **W-1 remediation**: cache invalidation on settlement wired — `applyMatchResult` now accepts optional `cacheOptions` (cache + listGroupIdsByTournament); `DrizzleGroupRepository.listGroupIdsByTournament()` added (4 RED→GREEN integration tests); `match-do.ts` passes CacheApiLeaderboardCache + DrizzleGroupRepository into applyMatchResult; 5 domain-level RED→GREEN invalidation tests added (including idempotent no-op guard). Spec MUST satisfied.
- [x] 4.4 Wire leaderboard loader `src/routes/leaderboard.$groupId.tsx` to read from cache first; fall back to DB SUM on miss; populate cache after DB read; cache write failures are non-fatal

### Phase 4.2: Match List + Score Stepper UI

- [x] 4.5 Extract `src/components/score-stepper.tsx`: large +/− buttons (44×44px min touch target w-11 h-11), controlled component, disabled prop, aria-labels for each direction, aria-live on value span
- [x] 4.6 **[BUG FIX]** Fix "saved prediction reverts to 0-0 on reload" bug: (1) added `findByUserForMatches(userId, matchIds)` to PredictionRepository port + DrizzlePredictionRepository (5 RED tests → GREEN); (2) `getMatches` loader now fetches user predictions and attaches `userPrediction: {homeGoals, awayGoals} | null` to each MatchListItem; (3) `PredictableCard` initializes `useState(match.userPrediction?.homeGoals ?? 0)`; (4) extracted `shapeMatchRows` pure helper to `-match-list-loader.ts` with 6 unit tests (RED → GREEN); (5) button copy: "Editar predicción" vs "Guardar predicción" per spec
- [x] 4.7 Write `src/components/prediction-drawer.tsx`: Vaul drawer (mobile bottom-sheet); server fn `getGroupPredictions` enforces lock server-side (returns 403 if not locked); client trigger hidden for unlocked matches; shows group members' frozen predictions with points
- [x] 4.8 **[RED]** Write `tests/e2e/match-views.spec.ts` (mobile viewport): all match-views spec scenarios covered
- [x] 4.9 **[GREEN]** All match-views E2E tests pass (7 scenarios, both projects, 50/50 total green); reload test (4.6 regression) proven with per-worker user isolation to handle parallel runs

### Phase 4.3: Leaderboard Full UI

- [x] 4.10 Upgraded `leaderboard.$groupId.tsx`: mobile card layout (MobileLeaderboardCard with RankBadge medals for top 3) + desktop table (DesktopLeaderboardTable with hover states); responsive via Tailwind md: breakpoint; @tanstack/react-table NOT installed — native HTML table used (deviation documented)

---

## PR 5 — Reminders / Web Push

### Phase 5.1: Web Push Subscription (test-first)

- [x] 5.1 **[RED]** Write `src/adapters/push/push-subscription.test.ts`: store subscription, fetch non-predictors, send push, handle 410-Gone cleanup (spec: reminders) — 10 tests RED confirmed
- [x] 5.2 **[GREEN]** Implement `src/adapters/push/push-subscription.ts`: VAPID keys from env; `web-push` library (already in devDeps); delete subscription on 410 response — all 10 tests GREEN
- [x] 5.3 Write `db/migrations/0004_push_subscriptions.sql`: `push_subscription(id, user_id FK, endpoint, p256dh, auth, created_at)` table + schema.ts Drizzle definition — note: migration numbered 0004 (0002 was taken by better_auth_tables)
- [x] 5.4 Write `src/routes/api/push/-subscribe.ts` + `-unsubscribe.ts`: POST stores/deletes subscription for authenticated user (uses `-` prefix convention matching existing routes)
- [x] 5.5 Write client-side `src/hooks/usePushSubscription.ts`: requests `Notification.permission`, calls subscribe API, handles browser support detection — not unit-covered (browser APIs; E2E deferred to PR 6)

### Phase 5.2: Reminder DO Alarm (test-first, workerd runtime)

- [x] 5.6 **[RED]** Write `src/workers/match-do.reminder.test.ts` (workers project): 4 tests covering reminder fires to non-predictors, skips predictors, schedule-alarm returns nextAlarmType:"reminder", settlement regression — all 4 RED confirmed
- [x] 5.7 **[GREEN]** Extend `match-do.ts` `alarm()` dispatch: schedules reminder at kickoff−30min first (when reminderOffsetMs provided); on fire via _doReminderAlarm, sends Web Push, re-schedules settlement alarm at kickoff+150min; nextAlarmType storage controls dispatch — all 12 workers tests GREEN (no regression in existing 8)

---

## PR 6 — Polish, Timezone Display, E2E Suite, CI Gate

### Phase 6.1: Timezone Display

- [x] 6.1 **W-2 remediation**: `formatKickoffUtc(kickoffUtc, timeZone?)` implemented in `src/routes/matches/-match-list-loader.ts`; optional `timeZone` parameter added for deterministic tests. `MatchHeader` in `matches/index.tsx` uses it. Kept in-situ (not promoted to src/utils).
- [x] 6.2 Replace all raw date strings in match list + detail with `formatKickoffUtc`; `$matchId.tsx` updated to use formatter + `title="tu hora local"` attribute; timezone label implicit via `timeZoneName:"short"` output.
- [x] 6.3 **[RED→GREEN]** 2 new IANA tz deterministic tests added to `-match-list-loader.test.ts`: America/Argentina/Buenos_Aires (UTC-3) and Europe/London (BST, UTC+1). Both RED (no optional arg), GREEN after formatter update. Total loader tests: 10.

### Phase 6.2: Empty States + UX Polish

- [x] 6.4 Empty states verified (all pre-existing): match list `data-testid="no-matches"` + `data-testid="nothing-to-predict"`; groups `data-testid="groups-empty-state"` (create/join prompt); leaderboard `data-testid="leaderboard-empty"`. No-members edge: getLeaderboard returns [] → empty state renders. All present and correct.
- [x] 6.5 Score stepper: `w-11 h-11` (44×44px) ✓; `aria-label="Decrease/Increase {label}"` ✓; `aria-live="polite"` on value span ✓. Prediction drawer: `DrawerClose` button added with `aria-label="Cerrar predicciones del grupo"` ✓.

### Phase 6.3: E2E Suite Expansion

- [x] 6.6 **[GREEN]** `tests/e2e/auth.spec.ts`: 4 scenarios all PASS — /groups unauthenticated now redirects (product fix); session persistence confirmed; user name in UI confirmed
- [x] 6.7 **[GREEN]** `tests/e2e/groups.spec.ts`: 4 scenarios all PASS — group create, invite link generation (click generate btn first), second user joins, shared leaderboard (e2e-user-2 seeded as member)
- [x] 6.8 **[GREEN]** `tests/e2e/reminders.spec.ts`: 3 scenarios all PASS — raw HTTP handlers at /api/push/subscribe and /api/push/unsubscribe wired in server.ts; DB reset in beforeEach isolates push_subscription state
- [x] 6.9 **[GREEN]** ALL 50 E2E tests pass (25 chromium-desktop + 25 chromium-mobile). Full suite green with Node 22.23.1.

### Phase 6.4: CI / Quality Gate

- [x] 6.10 `.github/workflows/ci.yml` updated: `lint` → `typecheck` → `unit tests` → `workers tests` → `build` (hard-fail). Separate `e2e` job with `continue-on-error: true` + `setup-node@v4 node-version: 22` + VAPID secrets forwarded.
- [x] 6.11 `tsc --noEmit`: 0 errors. ESLint: 0 errors, 0 warnings (fixed method-signature-style, no-unnecessary-type-assertion, no-unnecessary-condition, no-shadow, import/consistent-type-specifier-style, removed stale eslint-disable).
- [x] 6.12 `db/seeds/wc2026.sql` created: 1 tournament (wc-2026), 8 teams (ARG/BRA/FRA/ESP/GER/ENG/POR/ITA), 3 matches (scheduled/in_progress/finished), 2 users, 1 group + 2 memberships, 2 predictions with points (7 and 4).

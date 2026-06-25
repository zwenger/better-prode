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

- [ ] 1.1 **[RED]** Write `src/domain/scoring.test.ts`: 6×6 goal matrix, assert achievable set ⊆ {0,1,3,4,7}, assert 2/5/6 never returned (spec: scoring)
- [ ] 1.2 **[GREEN]** Implement `src/domain/scoring.ts`: pure `score(pred, result): number`; all 36 matrix cases pass
- [ ] 1.3 **[RED]** Write `src/domain/lock.test.ts`: `isLocked(kickoff, now, Clock)` returns true at T−5min, false before; uses FakeClock (spec: predictions)
- [ ] 1.4 **[GREEN]** Implement `src/domain/lock.ts`: server-clock only, inject Clock port
- [ ] 1.5 **[RED]** Write `src/domain/apply-match-result.test.ts`: idempotency (same args → no-op), manual-pins (auto cannot overwrite), re-settle on changed score (spec: result-triggering)
- [ ] 1.6 **[GREEN]** Implement `src/domain/apply-match-result.ts`: calls scoring, writes points, respects manual pin; depends only on ports (MatchRepository, PredictionRepository, Clock)

### Phase 1.2: Port Definitions

- [ ] 1.7 Write `src/domain/ports/result-source.ts` (ResultSource interface: `getResult(matchId)`), `src/domain/ports/repositories.ts` (MatchRepository, PredictionRepository interfaces)
- [ ] 1.8 Write in-memory stub implementations under `src/domain/ports/__stubs__/` for all ports; used by unit tests

### Phase 1.3: Durable Object — single-flight (test-first, workerd runtime)

- [ ] 1.9 **[RED]** Write `src/workers/match-do.test.ts` (workers project): 100 concurrent `fetch()` calls to DO → assert exactly 1 `applyMatchResult` invocation; assert idempotency on repeated calls (spec: result-triggering, testability)
- [ ] 1.10 **[GREEN]** Implement `src/workers/match-do.ts`: `MatchDO` class with `fetch()` handler, `alarm()` handler (kickoff+150min safety-net), single-flight via DO's single-thread guarantee; wires to domain `applyMatchResult`

### Phase 1.4: DB Adapters (integration, libSQL)

- [ ] 1.11 **[RED]** Write `src/adapters/db/match-repository.test.ts` (unit project, local libSQL): seed a match, call `getById`, `updateResult`, assert round-trip (spec: match-results)
- [ ] 1.12 **[GREEN]** Implement `src/adapters/db/match-repository.ts`: implements MatchRepository port against Turso/libSQL
- [ ] 1.13 **[RED]** Write `src/adapters/db/prediction-repository.test.ts`: insert prediction, update points, leaderboard SUM query (spec: predictions, leaderboard)
- [ ] 1.14 **[GREEN]** Implement `src/adapters/db/prediction-repository.ts`: implements PredictionRepository port; UNIQUE(user_id, match_id) constraint surfaced as domain error

### Phase 1.5: Tracer Bullet API Routes

- [ ] 1.15 Write `src/routes/api/predictions/submit.ts`: POST handler, validates auth session, calls `isLocked`, inserts/updates prediction; returns 423 if locked (spec: predictions)
- [ ] 1.16 Write `src/routes/api/admin/apply-result.ts`: POST handler (admin-only guard), dispatches to `MATCH_DO` binding; sets source=manual, pins (spec: result-triggering, match-results)
- [ ] 1.17 Write `src/routes/leaderboard.$groupId.tsx`: server loader fetches SUM from DB (no cache yet); renders top-3 names + points; functional not polished (spec: leaderboard)

### Phase 1.6: Tracer Bullet E2E

- [ ] 1.18 **[RED]** Write `tests/e2e/tracer-bullet.spec.ts` (mobile viewport): auth-bypass login → stepper visible → submit prediction → (admin call) applyMatchResult → leaderboard shows points (spec: testability)
- [ ] 1.19 **[GREEN]** Iterate until E2E green; do NOT polish UI yet

---

## PR 2 — Predictions (full) + Groups + Invitations

### Phase 2.1: Prediction Full Lock Path (test-first)

- [ ] 2.1 **[RED]** Write `tests/e2e/prediction-lock.spec.ts`: stepper disabled at T−5min (client); server returns 423 when POST arrives at/after lock regardless of client state (spec: predictions)
- [ ] 2.2 **[GREEN]** Harden `submit.ts`: enforce server-side lock with injected `SystemClock` in production path; return 423 with `{ reason: "match_locked" }`
- [ ] 2.3 **[RED]** Write unit tests for duplicate-prediction rejection: second insert for same (user, match) → domain error `DUPLICATE_PREDICTION`
- [ ] 2.4 **[GREEN]** Surface DB UNIQUE constraint as typed domain error in `prediction-repository.ts`

### Phase 2.2: Groups Domain (test-first)

- [ ] 2.5 **[RED]** Write `src/domain/groups.test.ts`: create group (owner auto-assigned), invite token generation, join via token, remove member (owner/admin only), owner cannot self-remove, promote/demote admin (spec: groups)
- [ ] 2.6 **[GREEN]** Implement `src/domain/groups.ts`: pure group operations depending only on repository ports
- [ ] 2.7 Write `src/domain/ports/repositories.ts` additions: GroupRepository, InvitationRepository interfaces
- [ ] 2.8 **[RED]** Write `src/adapters/db/group-repository.test.ts` + `invitation-repository.test.ts`: round-trips, token uniqueness, status transitions
- [ ] 2.9 **[GREEN]** Implement `src/adapters/db/group-repository.ts` and `src/adapters/db/invitation-repository.ts`

### Phase 2.3: Group API Routes + UI

- [ ] 2.10 Write `src/routes/groups/new.tsx`: create group form + server action (spec: groups)
- [ ] 2.11 Write `src/routes/groups/$groupId/invite.tsx`: invite link generation + copy button; server action revokes existing token on demand
- [ ] 2.12 Write `src/routes/invite/$token.tsx`: join-via-link page; server action validates token, creates membership, redirects to group
- [ ] 2.13 Write `src/routes/groups/$groupId/members.tsx`: member list; owner/admin sees remove buttons; member sees leave button; owner remove-self blocked in UI + server
- [ ] 2.14 Write empty-state route `src/routes/groups/index.tsx`: no-groups → prompt create or paste invite link (spec: groups)

---

## PR 3 — Result Ingestion + Full DO + Alarm + Scoring Exhaustive

### Phase 3.1: ResultSource Adapters (test-first)

- [ ] 3.1 **[RED]** Write `src/adapters/result-source/api-result-source.test.ts`: mock HTTP, assert normalization to UTC + canonical status; assert provider shape is never leaked to domain (spec: match-results)
- [ ] 3.2 **[GREEN]** Implement `src/adapters/result-source/api-result-source.ts`: Football-Data.org (or API-Football) behind ResultSource port; normalizes kickoff + status on ingest
- [ ] 3.3 **[RED]** Write `src/adapters/result-source/manual-result-source.test.ts`: manual submit sets source=manual, pins; auto adapter cannot overwrite pinned (spec: match-results)
- [ ] 3.4 **[GREEN]** Implement `src/adapters/result-source/manual-result-source.ts`
- [ ] 3.5 Verify existing `apply-match-result.test.ts` covers "manual wins and pins" path (add case if missing); assert no-op on identical re-settle

### Phase 3.2: DO Alarm — Safety-Net (test-first, workerd runtime)

- [ ] 3.6 **[RED]** Write `src/workers/match-do.alarm.test.ts` (workers project): advance fake clock past kickoff+150min; assert alarm fires exactly once; assert no-op if already settled (spec: result-triggering, testability)
- [ ] 3.7 **[GREEN]** Harden `match-do.ts` `alarm()`: check settled flag before calling `applyMatchResult`; do not reschedule; clear alarm after fire

### Phase 3.3: Lazy On-Demand Trigger

- [ ] 3.8 **[RED]** Write `src/routes/matches/$matchId.test.ts`: first viewer after FT → DO dispatched → points computed; second viewer → no-op (spec: result-triggering)
- [ ] 3.9 **[GREEN]** Implement lazy trigger in match detail server loader: if `match.status === 'finished' && !match.settled_at`, dispatch to MATCH_DO binding

### Phase 3.4: Scoring Matrix — Exhaustive CI Gate

- [ ] 3.10 Extend `scoring.test.ts` to the full 6×6 home×away matrix (all 36 combinations) with explicit expected values; add `it.each` table; assert impossibles (2, 5, 6) are never in the output set (spec: scoring)

---

## PR 4 — Leaderboard Caching + Match Views

### Phase 4.1: Leaderboard Edge Cache (test-first)

- [ ] 4.1 **[RED]** Write `src/adapters/cache/leaderboard-cache.test.ts`: cache hit returns stale data, invalidation clears entry, next read repopulates (spec: leaderboard)
- [ ] 4.2 **[GREEN]** Implement `src/adapters/cache/leaderboard-cache.ts`: Cache API (or KV) wrapper; key = `leaderboard:{groupId}:{tournamentId}`; invalidated inside `apply-match-result.ts` after points written
- [ ] 4.3 Wire cache invalidation: `apply-match-result.ts` calls `cachePort.invalidate(groupId, tournamentId)` after settlement; inject NoopCache in tests
- [ ] 4.4 Wire leaderboard loader `src/routes/leaderboard.$groupId.tsx` to read from cache first; fall back to DB SUM on miss

### Phase 4.2: Match List + Score Stepper UI

- [ ] 4.5 Write `src/components/score-stepper.tsx`: large +/− buttons (min touch target 44×44px), controlled component, disabled prop wired to lock state (spec: match-views)
- [ ] 4.6 Write `src/routes/matches/index.tsx`: match list grouped by date; in-progress matches surfaced at top; prediction entry via ScoreStepper; client disables at T−5min via `useEffect` + interval; server enforces lock independently (spec: match-views)
- [ ] 4.7 Write `src/components/prediction-drawer.tsx`: Vaul drawer (mobile bottom-sheet); shows frozen predictions of same-group members ONLY after lock; hidden before lock (spec: match-views)
- [ ] 4.8 **[RED]** Write `tests/e2e/match-views.spec.ts` (mobile viewport): predictions hidden before lock → visible after lock; stepper disabled at T−5min; drawer opens on tap (spec: match-views)
- [ ] 4.9 **[GREEN]** Iterate until E2E green

### Phase 4.3: Leaderboard Full UI

- [ ] 4.10 Upgrade `leaderboard.$groupId.tsx` to full TanStack Table: mobile card layout / desktop rows; per-match breakdown expandable row (spec: leaderboard)

---

## PR 5 — Reminders / Web Push

### Phase 5.1: Web Push Subscription (test-first)

- [ ] 5.1 **[RED]** Write `src/adapters/push/push-subscription.test.ts`: store subscription, fetch non-predictors, send push, handle 410-Gone cleanup (spec: reminders)
- [ ] 5.2 **[GREEN]** Implement `src/adapters/push/push-subscription.ts`: VAPID keys from env; `web-push` library; delete subscription on 410 response
- [ ] 5.3 Write `db/migrations/0002_push_subscriptions.sql`: `push_subscription(id, user_id FK, endpoint, p256dh, auth, created_at)` table
- [ ] 5.4 Write `src/routes/api/push/subscribe.ts` + `unsubscribe.ts`: POST stores/deletes subscription for authenticated user
- [ ] 5.5 Write client-side `src/hooks/usePushSubscription.ts`: requests `Notification.permission`, calls subscribe API, handles browser support detection

### Phase 5.2: Reminder DO Alarm (test-first, workerd runtime)

- [ ] 5.6 **[RED]** Write `src/workers/match-do.reminder.test.ts` (workers project): fake clock at kickoff−30min fires alarm; assert push sent only to non-predictors; assert already-predicted users skipped (spec: reminders, testability)
- [ ] 5.7 **[GREEN]** Extend `match-do.ts` `alarm()` dispatch: at scheduling, register reminder alarm at kickoff−30min; on fire, query non-predictors, send Web Push via push adapter; do not send if user has no subscription

---

## PR 6 — Polish, Timezone Display, E2E Suite, CI Gate

### Phase 6.1: Timezone Display

- [ ] 6.1 Write `src/utils/format-kickoff.ts`: `formatKickoff(utcIso, locale)` using `Intl.DateTimeFormat` with `timeZoneName: 'short'`; no server-side tz math (spec: match-views)
- [ ] 6.2 Replace all raw date strings in match list + detail with `formatKickoff`; add `(your local time)` label next to converted time
- [ ] 6.3 **[RED]** Write unit test for `formatKickoff`: assert UTC input produces locale-correct output for two different IANA tz strings

### Phase 6.2: Empty States + UX Polish

- [ ] 6.4 Add empty states: no-predictions prompt on match list; no-groups redirect; no-members edge case in leaderboard (spec: groups, match-views)
- [ ] 6.5 Verify all steppers meet 44×44px touch target; add `aria-label` to stepper buttons and prediction drawer close

### Phase 6.3: E2E Suite Expansion

- [ ] 6.6 **[RED]** Write `tests/e2e/auth.spec.ts` (test-auth-bypass path): unauthenticated route redirects to login; after bypass login, session persists across navigation (spec: auth)
- [ ] 6.7 **[RED]** Write `tests/e2e/groups.spec.ts` (mobile viewport): create group → copy invite link → second user joins → both see shared leaderboard (spec: groups)
- [ ] 6.8 **[RED]** Write `tests/e2e/reminders.spec.ts` (desktop): subscribe to push (mock SW) → fast-forward DO alarm → assert push payload delivered to mock endpoint (spec: reminders)
- [ ] 6.9 **[GREEN]** Iterate all E2E green in `vitest run --project e2e`

### Phase 6.4: CI / Quality Gate

- [ ] 6.10 Add GitHub Actions workflow `.github/workflows/ci.yml`: `lint` → `typecheck` → `test` (unit) → `test:workers` → `test:e2e` (headed=false); fails fast on any step
- [ ] 6.11 Run `tsc --noEmit` and ESLint with zero warnings/errors; fix any issues surfaced by full suite
- [ ] 6.12 Seed fixture `db/seeds/wc2026.sql`: 1 tournament, 8 teams, 3 matches (scheduled/in-progress/finished) + 2 users + predictions; used by integration + E2E baseline

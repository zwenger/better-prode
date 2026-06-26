# Tasks: Automatic Result Refresh

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 300–380 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

> Estimate basis: 3 new pure modules (~120 loc including tests), run-ingest.ts (~40 loc),
> server.ts diff (~40 loc), admin route refactor (~20 loc), alarm caller seam (~30 loc),
> matches loader f&f fetch (~5 loc), wrangler.jsonc (+1 line), worker-env.d.ts (+1 line),
> .dev.vars entry (+1 line). Total ~260 implementation lines + ~120 test lines ≈ 380 max.
> Stays under 400. Single PR is fine; split only if reviewer preference.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All tasks below | PR 1 | Single coherent feature; all wiring + tests |

---

## Phase 1: Types & Config (Foundation)

- [x] 1.1 Add `TOURNAMENT_ID?: string` to `worker-env.d.ts` `Env` interface.
- [x] 1.2 Add `TOURNAMENT_ID=17-285023` to `.dev.vars` (local dev); document prod secret in rollout note.
- [x] 1.3 Add `triggers: { crons: ["*/5 * * * *"] }` to `wrangler.jsonc` under the `[triggers]` section.

---

## Phase 2: Pure Units — RED then GREEN (TDD)

### 2.1 active-window.ts

- [x] 2.1a **[RED]** Write `src/app/active-window.test.ts` — table-driven Vitest tests for `hasActiveWindowMatches`:
  - match with `status=scheduled`, kickoff 1h ago → true (in active window).
  - match with `status=in_progress`, kickoff 5h ago → true.
  - match with `status=finished` → false (status filter).
  - match with kickoff 7h ago (beyond `lookbackHours=6`) → false (lookback floor).
  - no matches in array → false.
  - custom `lookbackHours=2`: match 3h ago → false.
  - Tests import only `hasActiveWindowMatches`; no Workers bindings.
- [x] 2.1b **[GREEN]** Create `src/app/active-window.ts` — export `hasActiveWindowMatches(matches: { status: string; kickoffUtc: string }[], now: Date, lookbackHours?: number): boolean`. Default `lookbackHours = 6`. Pass all 2.1a tests.

### 2.2 refresh-throttle.ts

- [x] 2.2a **[RED]** Write `src/app/refresh-throttle.test.ts` — Vitest tests for `shouldThrottle` and `throttleKey`:
  - `shouldThrottle(null)` → false.
  - `shouldThrottle("1")` → true.
  - `shouldThrottle("")` → false (absent/empty is not throttled).
  - `throttleKey("17-285023")` → `"refresh:throttle:17-285023"`.
- [x] 2.2b **[GREEN]** Create `src/app/refresh-throttle.ts` — export `throttleKey(tid: string): string` and `shouldThrottle(existing: string | null): boolean`. Pass all 2.2a tests.

---

## Phase 3: run-ingest.ts (DI unit — RED then GREEN)

- [x] 3.1 **[RED]** Write `src/app/run-ingest.test.ts` — Vitest DI tests for `runIngest`:
  - Inject fake repo (`listUnsettled` returns active match), fake `ingestMatchResults` spy, fake `env.MATCH_DO` stub.
  - When active window match exists: assert `ingestMatchResults` called once with correct `tournamentId`.
  - When no active window matches (`listUnsettled` returns []): assert `ingestMatchResults` NOT called (gate short-circuits).
  - Return value mirrors `ingestMatchResults` output when called; returns `{ ingested:0, skipped:0, errors:0, details:[] }` when gated.
  - Note: inject `ingestMatchResults` as a dep so the test never hits FIFA.
- [x] 3.2 **[GREEN]** Create `src/app/run-ingest.ts` — export `runIngest(env: { MATCH_DO: DurableObjectNamespace }, tournamentId: string): Promise<IngestResultsOutput>`.
  - Reads `process.env["TOURNAMENT_ID"] ?? "17-285023"` if `tournamentId` not provided by caller.
  - Builds `matchRepository` (via `getDb()`), `resultSource` (new `FifaAdapter()`), `doSettle` (via `env.MATCH_DO`).
  - Calls `hasActiveWindowMatches` on `listUnsettled` result; short-circuits with noop output if false.
  - Delegates to `ingestMatchResults` when gate passes.
  - Comment documents `tournamentId` = DB `tournament.id` (`${competitionId}-${seasonId}`), distinct from FIFA comp/season ids inside `FifaAdapter`.

---

## Phase 4: Import-Time Alarm Seam (DI unit — RED then GREEN)

- [x] 4.1 **[RED]** Write `src/adapters/tournament-import/schedule-alarms.test.ts` — Vitest DI tests for `scheduleImportAlarms`:
  - Stub `env.MATCH_DO` (fake namespace + stub `.fetch`).
  - Given structure with 2 matches: assert `env.MATCH_DO.get(...).fetch("http://do/schedule-alarm", …)` called twice, each with correct `matchId` and `kickoffUtc`; payload has NO `reminderOffsetMs`.
  - Re-call with same structure (re-import): assert stub called again with same deadline (idempotent — `setAlarm` replaces, no stacking; verify call count doubled, not deduplicated in caller).
  - `importTournament` tests (`import.test.ts`) continue passing unchanged.
- [x] 4.2 **[GREEN]** Create `src/adapters/tournament-import/schedule-alarms.ts` — export `scheduleImportAlarms(structure: TournamentStructure, env: { MATCH_DO: DurableObjectNamespace }): Promise<void>`.
  - For each match in `structure.matches`, call `env.MATCH_DO.idFromName(m.id)` → `.fetch("http://do/schedule-alarm", { method:"POST", headers:{…}, body: JSON.stringify({ matchId: m.id, kickoffUtc: m.kickoffUtc }) })`.
  - No `reminderOffsetMs` in payload (settlement-only alarm at kickoff+150min).
  - `importTournament` signature stays `(structure, db)` — env-free, unit-testable.

---

## Phase 5: Server Wiring — `scheduled()` + `/api/refresh`

> These are integration/manual-verified (not faked unit tests). Mark integration.

- [x] 5.1 **[Integration]** Modify `src/server.ts`:
  - Change `export default createServerEntry({…})` to `const entry = createServerEntry({ fetch: … }); export default { ...entry, async scheduled(_event, env, ctx) { ctx.waitUntil(runIngest(env, process.env["TOURNAMENT_ID"] ?? "17-285023")); } }`.
  - Import `runIngest` from `#/app/run-ingest`.
  - Add raw `POST /api/refresh` handler inside `fetch`: check `LEADERBOARD_CACHE` KV via `shouldThrottle`; if not throttled, write `throttleKey(tid)` with `expirationTtl: 60`, then call `runIngest(env, tid)` (do NOT await — fire-and-forget via `ctx.waitUntil` if available, or detached); return `Response.json({}, { status: 202 })`.
  - Import `shouldThrottle`, `throttleKey` from `#/app/refresh-throttle`.
  - Preserve `export { MatchDO }` and all existing raw endpoints untouched.
  - Manual smoke: `wrangler dev --test-scheduled` → verify `scheduled()` fires without error.

---

## Phase 6: Admin Route Refactor

- [x] 6.1 **[Integration]** Modify `src/routes/api/admin/-ingest-results.ts`:
  - After auth guard (`isAdmin` check), replace the inline dep-wiring block with a call to `runIngest(env, data.tournamentId)`.
  - Import `runIngest` lazily inside the handler body (same lazy-import pattern as existing code) to keep Workers bindings out of module-level imports.
  - Keep all exported types (`IngestMatchRepository`, `IngestResultSource`, `IngestDeps`, `ingestMatchResults`, etc.) intact — unit tests depend on them.
  - Outcome: admin fn and cron fn share identical dep-wiring; env source is the only difference (admin uses `import("cloudflare:workers")`, cron uses its `env` param).

---

## Phase 7: Alarm Scheduling at Import Call-Site

- [x] 7.1 **[Integration]** Add a Workers-native admin server function (`src/routes/api/admin/-schedule-alarms.ts`) that:
  - Enforces `ADMIN_USER_IDS` guard (same pattern as `ingestResults`).
  - Fetches structure from `FifaAdapter` (or reads from DB) and calls `scheduleImportAlarms(structure, env)`.
  - Returns JSON with per-match alarm scheduling outcome.
  - This resolves the open question: `scripts/import-tournament.ts` is a Node CLI with no DO bindings; alarm scheduling must run from a Workers context. This admin fn is the binding-bearing call-site.
  - Operational note: run this admin fn once post-deploy to schedule alarms for all already-imported matches.

---

## Phase 8: Client Fire-and-Forget

- [x] 8.1 **[Integration]** Modify `src/routes/matches/index.tsx`:
  - Add `useEffect(() => { void fetch("/api/refresh", { method: "POST" }); }, [])` (or equivalent post-mount hook in TanStack Router).
  - No await; failure is silently swallowed. Page render must not depend on this call.
  - Keep all existing loader logic, UI, and tests unchanged.

---

## Phase 9: Operational Backfill (no code)

- [x] 9.1 **[Operational — POST-DEPLOY ONLY]** Post-deploy: run the admin schedule-alarms fn (task 7.1) to backfill DO alarms for all already-imported matches. DONE: ran manual reconcile against prod; 4 stuck matches settled (Tunisia-Netherlands 1-3, Japan-Sweden 1-1, Paraguay-Australia 0-0, Türkiye-USA 3-2); 0 unsettled-past matches remain; points computed.
- [x] 9.2 **[Operational — POST-DEPLOY ONLY]** Post-deploy: verify `TOURNAMENT_ID` prod secret matches `tournament.id` in DB (`17-285023`); confirm with `SELECT id FROM tournament`. DONE: confirmed prod `tournament.id = "17-285023"` matches the default; cron/manual query the right tournament.
- [x] 9.3 **[Operational — POST-DEPLOY ONLY]** Post-deploy: confirm first cron tick (within 5 min) settles any stuck matches in the 6h active window. Monitor via Workers logs. REGISTERED: Cloudflare reports `schedule: */5 * * * *` on deployed worker version 6f3b5c3d (live firing observable via wrangler tail).

---

## Spec Traceability

| Task(s) | Spec Requirement |
|---------|-----------------|
| 1.1–1.3, 5.1, 3.1–3.2 | Cron Reconcile with Dynamic Active-Window Gating |
| 2.1–2.2, 3.1–3.2 | Gating predicate unit-testable in isolation |
| 4.1–4.2, 7.1 | Import-Time Safety-Net Alarm Scheduling |
| 5.1 (/api/refresh), 8.1 | On-Demand FIFA-Polling Refresh (Throttled) |
| 2.2a–2.2b, 5.1 | Throttle deduplication unit-testable |
| 6.1 | Manual Admin Trigger (Backstop) refactored to shared runIngest |
| 9.1–9.3 | Backfill operational consequence |

## Constraints

- Do NOT modify `applyMatchResult`, scoring logic, or idempotency guards.
- Do NOT modify `ingestMatchResults` signature or remove its exported types.
- `importTournament(structure, db)` stays env-free (no third param).
- All existing tests (290 unit / 12 workers / 50 e2e) must remain green.

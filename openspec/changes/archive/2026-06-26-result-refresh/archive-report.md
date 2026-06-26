# Archive Report: result-refresh

**Change**: result-refresh
**Archived**: 2026-06-26
**Artifact store**: Hybrid (Engram + openspec)
**Archive path**: `openspec/changes/archive/2026-06-26-result-refresh/`

---

## What Shipped

Four automatic result-refresh mechanisms were implemented, all routing through the existing `applyMatchResult` choke point with no new settlement, scoring, or idempotency logic:

1. **Cron Reconcile (dynamic, active-window gated)** — Cloudflare Workers `scheduled()` handler fires every 5 minutes (`*/5 * * * *`). Queries the DB first; only polls FIFA when active-window matches exist (kicked off, not yet finished, within 6h lookback). Near-noop otherwise.

2. **Import-Time Safety-Net Alarm Scheduling** — `scheduleImportAlarms(structure, env)` is called alongside tournament import to POST `/schedule-alarm` per match to the per-match DO at kickoff + 150 min. Idempotent (`setAlarm` replaces; re-import re-sets the same deadline). `importTournament(structure, db)` remains env-free.

3. **On-Demand Throttled Refresh** — `POST /api/refresh` raw endpoint in `server.ts`. KV throttle (key `refresh:throttle:{tournamentId}`, 60s TTL) deduplicates concurrent user bursts to at most one FIFA poll per minute. Client fires it post-mount as fire-and-forget (`void fetch`); page render does not block.

4. **Manual Admin Trigger (Backstop)** — `runIngest` is shared by cron, on-demand, and the admin server fn. The admin path calls `runIngest(env, tid, { skipWindowGate: true })` so it bypasses the 6h lookback floor entirely, making it the genuine backstop for matches stuck beyond the active window.

---

## Production Fix Applied (Post-Deploy)

All three post-deploy operational tasks completed before archive:

| Task | Evidence |
|------|----------|
| **9.1 Backfill** | Manual reconcile ran against prod; 4 stuck matches settled: Tunisia-Netherlands 1-3, Japan-Sweden 1-1, Paraguay-Australia 0-0, Türkiye-USA 3-2. 0 unsettled-past matches remain. Points computed. |
| **9.2 TOURNAMENT_ID** | Confirmed prod `tournament.id = "17-285023"` matches the default. Cron and manual query the correct tournament. |
| **9.3 Cron tick** | Cloudflare reports `schedule: */5 * * * *` on deployed worker version `6f3b5c3d`. Live firing observable via `wrangler tail`. Future-match settlement will confirm automatic convergence. |

---

## Final Test Posture

| Suite | Result |
|-------|--------|
| `npx vitest run --project unit` | 319/319 passed (29 files) |
| `npx vitest run --project workers` | 12/12 passed (3 files) |
| `npm run test:e2e` | 50/50 passed |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors |

New tests added: 24 (8 active-window + 6 refresh-throttle + 6 run-ingest incl. skipWindowGate + 4 schedule-alarms).

---

## Key Finding from Review

**Manual admin path MUST bypass the 6h active-window gate.** The initial implementation called `runIngest(env, tid)` without options, meaning the admin backstop inherited the same 6h lookback floor as cron — it returned NOOP for matches older than 6h, breaking its core purpose.

Fix: `RunIngestOptions.skipWindowGate?: boolean` was added. The admin fn calls `runIngest(env, tid, { skipWindowGate: true })`. Cron and on-demand remain gated. This deviation from the original design sketch is captured in apply-progress and verified by 3 additional TDD tests (RED→GREEN).

---

## Engram Observation IDs (Traceability)

| Artifact | Engram ID |
|----------|-----------|
| proposal | #690 |
| spec | #691 |
| design | #692 |
| tasks | #693 |
| verify-report | #695 |

---

## Files Delivered

| File | Action |
|------|--------|
| `src/worker-env.d.ts` | Modified — added `TOURNAMENT_ID?: string` |
| `.dev.vars` | Modified — added `TOURNAMENT_ID=17-285023` |
| `wrangler.jsonc` | Modified — added `triggers.crons ["*/5 * * * *"]` |
| `src/app/active-window.test.ts` | Created |
| `src/app/active-window.ts` | Created |
| `src/app/refresh-throttle.test.ts` | Created |
| `src/app/refresh-throttle.ts` | Created |
| `src/app/run-ingest.test.ts` | Created |
| `src/app/run-ingest.ts` | Created |
| `src/adapters/tournament-import/schedule-alarms.test.ts` | Created |
| `src/adapters/tournament-import/schedule-alarms.ts` | Created |
| `src/server.ts` | Modified — restructured: entry + scheduled() + /api/refresh |
| `src/routes/api/admin/-ingest-results.ts` | Modified — refactored to call runIngest |
| `src/routes/api/admin/-schedule-alarms.ts` | Created |
| `src/routes/matches/index.tsx` | Modified — post-mount fire-and-forget fetch |

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| result-triggering | Updated | 3 requirements added (Cron Reconcile, Import-Time Alarm Scheduling, On-Demand Throttled Refresh); 1 requirement modified (Manual Admin Trigger — now full active-source reconcile, not just applying a known result); Purpose updated to reflect 4 trigger paths |

---

## SDD Cycle Complete

The change was fully planned, implemented, verified, and archived.
All 9 phases complete. 0 blocking issues. 0 CRITICAL findings. 2 suggestions (documented, no action required).

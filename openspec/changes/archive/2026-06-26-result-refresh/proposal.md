# Proposal: Automatic Result Refresh

## Intent

In production, match results stay stuck at `scheduled` because nothing automatically polls FIFA. The lazy on-demand trigger only fires when `match.status === "finished"` in the DB, but that status is never updated unless someone manually runs the admin ingest. The only FIFA-polling path is the admin GET, run once. DO safety-net alarms are never scheduled at import, so they never fire. Result: every match after the single manual run never settles. This change adds automatic, on-demand, and safety-net refresh that polls FIFA and converges results, closing the gap the `result-triggering` spec assumed was covered.

## Scope

### In Scope
- **Cron reconcile (dynamic)**: scheduled handler that polls FIFA only when matches have kicked off and are not yet finished (active window); near-noop otherwise.
- **Per-match DO alarm at import** (kickoff+150min): self-healing safety net so future matches converge even if cron and on-demand fail.
- **On-demand refresh on app entry** (throttled): background FIFA poll for overdue/unsettled matches; lowest latency.
- **Manual admin ingest**: expose/trigger the existing `ingestMatchResults` path.
- **One-time backfill** of currently stuck matches (first cron run / manual ingest handles this; no separate mechanism).
- All four paths funnel through `ingestMatchResults` → `MATCH_DO /settle` → `applyMatchResult` — no new settlement, scoring, or idempotency logic.

### Out of Scope
- Redesigning scoring or points computation.
- Changing the FIFA adapter's data contract or `getResult` behavior.
- Multi-tournament generalization beyond sourcing one tournament ID (carried as a design decision).
- New admin auth model — reuse existing `ADMIN_USER_IDS` guard.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `result-triggering`: add three requirements — Cron Reconcile (dynamic, FIFA-polling, active-window gated), On-Demand FIFA-Polling Refresh (throttled background poll on app entry), and Import-Time Alarm Scheduling (schedule the safety-net DO alarm at tournament import). The existing lazy/alarm/manual requirements assumed DB status was already `finished`; this delta makes the system actually fetch results from FIFA.

## Approach

- **Cron**: add `triggers.crons` to `wrangler.jsonc`; change `src/server.ts` to spread the `createServerEntry()` result and add a `scheduled(event, env, ctx)` handler. Wire deps from the `env` param (repo, `FifaAdapter`, `MATCH_DO`) and call existing `ingestMatchResults`. Gate: only poll FIFA when active matches exist.
- **On-demand**: in the `getMatches` loader, detect overdue/unsettled matches and fire a throttled background poll. `ctx.waitUntil` availability from a server fn is unconfirmed — design must resolve fallback (client fire-and-forget fetch, or a raw HTTP refresh endpoint in `server.ts`).
- **Import-time alarm**: extend tournament import to call `/schedule-alarm` per match at import.
- **Manual**: surface the existing `ingestResults` server fn (admin UI button or route).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `wrangler.jsonc` | Modified | Add `triggers.crons` |
| `src/server.ts` | Modified | Spread entry + add `scheduled()`; possibly raw refresh endpoint |
| `src/routes/matches/index.tsx` | Modified | Throttled on-demand background poll in loader |
| Tournament import path | Modified | Schedule per-match DO alarm at import |
| `src/routes/api/admin/-ingest-results.ts` | Reused | Core `ingestMatchResults` unchanged |
| Admin UI (new route/button) | New | Trigger manual ingest |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `ctx.waitUntil` unavailable in server fn | Med | Design fallback: client fetch or raw HTTP endpoint |
| FIFA rate limits vs cron cadence | Med | Dynamic gating + throttle; tune cadence in design |
| Tournament ID hardcoded vs env | Med | Recommend env var; decide in design |
| Throttle store choice (reuse `LEADERBOARD_CACHE` vs new KV) | Low | Decide in design |
| Thundering-herd / duplicate settles | Low | Already handled by DO single-flight + idempotency (`result-triggering`) |

## Rollback Plan

- Remove `triggers.crons` from `wrangler.jsonc` and revert `src/server.ts` to `export default createServerEntry(...)` → cron disabled instantly.
- Revert the loader change → on-demand disabled.
- Import-time alarm and manual ingest are additive and idempotent; safe to leave or revert independently.

## Dependencies

- Cloudflare cron triggers (Workers `scheduled` handler).
- Existing `FifaAdapter`, `MATCH_DO`, `ingestMatchResults` choke point.

## Success Criteria

- [ ] A finished match converges to `finished` with points written without any manual action.
- [ ] Cron does a near-noop when no matches are in the active window.
- [ ] Previously stuck matches are backfilled on first cron run / manual ingest.
- [ ] All settlement still passes through `applyMatchResult` (no bypass).
- [ ] New gating/throttle/alarm-scheduling logic is unit-tested; cron wiring integration/manual-tested.

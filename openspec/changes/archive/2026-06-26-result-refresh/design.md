# Design: Automatic Result Refresh

## Technical Approach

Four trigger paths (cron, import-time alarm, on-demand, manual admin) all funnel
into the existing `ingestMatchResults` → `MATCH_DO /settle` → `applyMatchResult`
choke point. No new settlement/scoring/idempotency logic. The only NEW code is
*wiring* and three small *pure* predicates. We extract a shared `runIngest(env, tournamentId)`
so the cron `scheduled()` handler and the admin server fn differ only in how they
source `env`. Gating and throttling keep external FIFA calls near-zero when idle.

## Architecture Decisions

### Decision 1 — `scheduled()` wiring + shared `runIngest`

**Choice**: In `server.ts`, change the default export to
`const entry = createServerEntry({ fetch })` then
`export default { ...entry, async scheduled(_event, env, ctx) { ctx.waitUntil(runIngest(env, TOURNAMENT_ID)); } }`.
`runIngest(env, tournamentId)` is a new module (`src/app/run-ingest.ts`) that builds
`matchRepository` (via `getDb()`), `resultSource` (`new FifaAdapter()`), and
`doSettle` (via `env.MATCH_DO`), then calls `ingestMatchResults`. The admin server fn
is refactored to call `runIngest(env, …)` after its auth guard, where `env` comes
from `import("cloudflare:workers")`; the cron handler passes its `env` param.
**Alternatives**: inline the deps in both places (duplication); put deps in the DO.
**Rationale**: `env` is the ONLY difference between cron and admin. `getDb()` reads
`process.env` (works in both fetch and scheduled under `nodejs_compat`); `MATCH_DO`
must come from the binding-bearing `env`. Spreading the entry preserves `fetch`
while adding `scheduled` — matches the existing custom-entry constraint (issue #11100).

### Decision 2 — Dynamic active-window gating + cadence

**Choice**: Cron expression `*/5 * * * *` (every 5 min) in `wrangler.jsonc`
`triggers.crons`. Before calling FIFA, run a pure predicate
`hasActiveWindowMatches(matches, now, lookbackHours = 6) → boolean`: true iff some
match has `status ∈ {scheduled,in_progress}` AND `kickoff <= now` AND
`kickoff > now − 6h`. `runIngest` short-circuits when false (no FIFA call).
**Alternatives**: poll always (wasteful, FIFA rate-limit risk); 1-min cadence (costlier).
**Rationale**: A match resolves well within 6h of kickoff (90min + stoppage + buffer);
`X = 6h` keeps polling a stuck match long enough to self-heal yet stops hammering FIFA
for ancient unsettled rows. 5-min cadence converges results within a tournament-acceptable
window. The DB query reuses the existing `listUnsettled` shape (already filters
`status` + `kickoff <= now`); the lookback floor is applied by the pure predicate.

### Decision 3 — On-demand: raw `/api/refresh` + client fire-and-forget

**Choice**: Add raw HTTP `POST /api/refresh` in `server.ts` (same pattern as the
existing push/prediction raw endpoints). It checks the KV throttle; if absent, writes
the key and runs `runIngest(env, TOURNAMENT_ID)`, returning `202`. The matches loader
component fires it client-side post-mount via `void fetch("/api/refresh", {method:"POST"})`
WITHOUT awaiting — render never blocks and a failure is swallowed.
**Alternatives**: (a) `ctx.waitUntil` inside a server fn — TanStack `createServerEntry`
fetch wrapper does not reliably expose `ExecutionContext`; unconfirmed → rejected.
(b) reuse admin path with a non-admin variant — leaks the admin choke point.
**Rationale**: Client-side fire-and-forget guarantees the page renders regardless of
server `ctx` availability (mobile/UX constraint). The throttle makes concurrent bursts
near-noops. Raw endpoint mirrors a proven in-repo pattern.

### Decision 4 — Throttle store: reuse `LEADERBOARD_CACHE` KV

**Choice**: Reuse the existing `LEADERBOARD_CACHE` KV binding. Key
`refresh:throttle:{tournamentId}`, value `"1"`, `expirationTtl: 60` (60s).
Pure predicate `shouldThrottle(existingValue) → boolean` (present → skip).
**Alternatives**: new `REFRESH_THROTTLE` binding (extra infra, no benefit).
**Rationale**: One KV namespace already provisioned; namespacing by key prefix avoids
a new binding + deploy config. 60s TTL dedupes user bursts while still allowing the
next 5-min cron tick to proceed unthrottled (cron does not consult the throttle).

### Decision 5 — Tournament ID source: env var `TOURNAMENT_ID`

**Choice**: Add `TOURNAMENT_ID` (the DB `tournament.id`, e.g. `"17-285023"`) as a
Workers var/secret, read via `process.env["TOURNAMENT_ID"]` in `runIngest` and the
raw refresh endpoint. Hardcoded fallback `"17-285023"` if unset.
**Alternatives**: hardcode in `runIngest`.
**Rationale**: The DB `tournamentId` is `${competitionId}-${seasonId}` (set by
`fetchStructure`). FIFA competition/season ids (17/285023) stay hardcoded INSIDE
`FifaAdapter.getResult` — that is FIFA-provider config, separate from the DB key used
to scope `listUnsettled`. Env var lets prod point at the active tournament without a
code change; the relationship (DB id ≠ FIFA ids) is documented in `run-ingest.ts`.

### Decision 6 — Import-time alarm: schedule per-match in import flow

**Choice**: After the match upsert loop in `importTournament`, for each match call
`env.MATCH_DO.get(idFromName(m.id)).fetch("http://do/schedule-alarm", … {matchId, kickoffUtc})`.
Since `importTournament(structure, db)` has no `env`, add a thin caller layer
(`scheduleImportAlarms(structure, env)`) invoked alongside import at the import
call-site, OR thread `env` into the import orchestrator. Pass NO `reminderOffsetMs`
(settlement-only alarm at kickoff+150min) unless reminders are already wired.
**Idempotency**: `setAlarm` REPLACES the single DO alarm — re-import re-sets the same
deadline, never stacks. DO storage `alarmCommand` is overwritten harmlessly. Re-import
of a settled match is a no-op at fire time (existing `settleCount > 0` guard).
**Rationale**: DOs allow exactly one alarm; `setAlarm` is inherently idempotent per
match (keyed by `idFromName(matchId)`). Keeping `importTournament` env-free preserves
its unit-testability; the alarm scheduling is a separate, stubbable seam.

### Decision 7 — Backfill: falls out of cron/manual

**Choice**: No dedicated code. The first `*/5` cron tick (or a manual admin reconcile)
sees stuck matches inside the 6h active window via `listUnsettled` and settles them.
Matches older than 6h are NOT auto-backfilled by cron — admin manual reconcile (which
does NOT apply the lookback floor) is the backstop for those.
**Rationale**: Spec states backfill is an operational consequence, not a mechanism.

## Data Flow

    cron */5  ─┐
    /api/refresh (client f&f, KV-throttled) ─┤
    admin server fn (ADMIN_USER_IDS guard)   ─┼─→ runIngest(env, tid)
    DO alarm (kickoff+150m, import-scheduled) ┘        │
                                                       ▼
                              hasActiveWindowMatches? ──no──→ noop
                                       │ yes
                                       ▼
                  ingestMatchResults → FifaAdapter.getResult
                                       │
                                       ▼
                       env.MATCH_DO /settle  (single-flight)
                                       │
                                       ▼
                       applyMatchResult (choke point, idempotent)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/app/run-ingest.ts` | Create | Shared `runIngest(env, tournamentId)`; builds repo/source/doSettle, applies `hasActiveWindowMatches` gate, calls `ingestMatchResults`. |
| `src/app/active-window.ts` | Create | Pure `hasActiveWindowMatches(matches, now, lookbackHours)` predicate. |
| `src/app/refresh-throttle.ts` | Create | Pure `shouldThrottle(value)` + KV key helper `throttleKey(tid)`. |
| `src/server.ts` | Modify | Spread `createServerEntry` + add `scheduled()` using `ctx.waitUntil(runIngest(...))`; add raw `POST /api/refresh` (KV throttle → runIngest). |
| `wrangler.jsonc` | Modify | Add `triggers.crons: ["*/5 * * * *"]`. |
| `src/routes/api/admin/-ingest-results.ts` | Modify | Refactor handler to call `runIngest(env, tid)` after auth guard (keep `ingestMatchResults` export for unit tests). |
| `src/adapters/tournament-import/import.ts` (or its caller) | Modify | After match upsert, schedule per-match DO `/schedule-alarm` at kickoff+150min via injected `env`. |
| `src/routes/matches/index.tsx` | Modify | Post-mount client `void fetch("/api/refresh", {method:"POST"})` fire-and-forget. |
| `worker-env.d.ts` | Modify | Add `TOURNAMENT_ID?: string` to `Env`. |

## Interfaces / Contracts

```ts
// src/app/active-window.ts
export function hasActiveWindowMatches(
  matches: { status: string; kickoffUtc: string }[],
  now: Date,
  lookbackHours?: number, // default 6
): boolean;

// src/app/refresh-throttle.ts
export function throttleKey(tournamentId: string): string; // `refresh:throttle:${id}`
export function shouldThrottle(existing: string | null): boolean; // present → true

// src/app/run-ingest.ts
export async function runIngest(
  env: { MATCH_DO: DurableObjectNamespace },
  tournamentId: string,
): Promise<IngestResultsOutput>; // gate-then-ingest; near-noop when no active window
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (pure) | `hasActiveWindowMatches` (in/out of window, status filter, lookback floor) | Vitest, table-driven, fake `now`. |
| Unit (pure) | `shouldThrottle` / `throttleKey` | Vitest, present/absent value. |
| Unit (DI) | `runIngest` gate short-circuits FIFA when no active window; calls `ingestMatchResults` when active | Inject fake repo/source/doSettle; assert FIFA not called when gated. |
| Unit (DI) | Import-time alarm: stub DO `/schedule-alarm`, assert called per match with kickoff+150min deadline; re-import does not stack | Stub `env.MATCH_DO`. |
| Integration | DO `/settle` + `applyMatchResult` | Existing tests — unchanged. |
| Manual/integration | `scheduled()` handler firing; cron wiring; `/api/refresh` 202; client f&f non-blocking | Local `wrangler dev --test-scheduled`; manual prod smoke. |

## Migration / Rollout

No data migration. Set `TOURNAMENT_ID` secret/var in prod. Rollback: remove
`triggers.crons` + revert `server.ts` `scheduled`/`/api/refresh`; loader fetch,
import-alarm, and admin refactor are independently revertible and idempotent.

## Open Questions

- [ ] Confirm `TOURNAMENT_ID` prod value matches the imported DB `tournament.id` (`17-285023`).
- [ ] Confirm import call-site that can thread `env` for alarm scheduling (where `importTournament` is invoked with a binding-bearing context).

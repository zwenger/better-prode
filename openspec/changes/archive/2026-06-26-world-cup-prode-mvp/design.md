# Design: World Cup Prode MVP

## Technical Approach

Hexagonal core (pure TS, zero infra deps) wrapped by TanStack Start SSR on Cloudflare with Turso/libSQL persistence. The domain (Match, Prediction, scoring, lock rule) talks only to ports: `Clock`, `ResultSource`, and repositories. Everything time-sensitive flows through an injectable `Clock`; everything result-related funnels through one idempotent `applyMatchResult` choke point serialized by a per-match Durable Object. This delivers the proposal's goals — survive the match-time read spike, never double-compute, deterministic testing without Cloudflare/Turso in the loop.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| 1 | Architecture style | Hexagonal ports/adapters; domain depends on nothing | Framework-centric services calling DB/SDK directly | Domain testable in-memory; provider/DB are swappable details (proposal: provider not yet chosen) |
| 2 | Time | Injectable `Clock` port; domain never calls `Date.now()` | Ambient `Date.now()` | Deterministic lock/alarm tests; security lock is server-clock only |
| 3 | Result entry | Single `applyMatchResult(match, score, status, source)` choke point | Separate paths for API/manual/alarm | One idempotent funnel = no double compute, "manual wins and pins" enforced in one place |
| 4 | Concurrency | Per-match Durable Object (single-threaded) for single-flight + idempotency | App-layer locks / DB advisory locks | DO is natively serialized; absorbs thundering herd; reused for reminder alarms |
| 5 | Scoring storage | Store `Prediction.points` at settlement; leaderboard = `SUM` | Compute leaderboard on read | Points change a few times/day → one indexed aggregate, highly cacheable |
| 6 | Leaderboard spike | Edge-cache leaderboard, invalidate on recompute | Hit Turso every refresh | ~95% reads are frozen; spike hits edge, not DB; free-tier safe |
| 7 | Timezones | UTC inside, `Intl.DateTimeFormat` at display edge | Per-user tz columns / server-side localization | No DST math server-side; browser knows user tz |
| 8 | Auth | Better Auth + Google OAuth, server sessions | Clerk / Lucia | Users in own DB; Lucia deprecated; lock check is server-authoritative |

## Data Flow

    [Viewer hits match page after FT]
            │ lazy trigger
            ▼
    Worker ──get DO stub(matchId)──> Per-Match DO ──(single-flight)──┐
            ▲                              │                          │
            │ DO alarm (kickoff+150m)──────┘                          ▼
            │ admin manual ───────────────────────────────► applyMatchResult(domain)
                                                                      │
                                          ┌───────────────────────────┤
                                          ▼                           ▼
                                 ResultSource.fetch()         score(prediction,result)
                                 (API|manual adapter,         → Prediction.points
                                  normalizes→UTC)                     │
                                                                      ▼
                                          repos.persist + invalidate leaderboard cache
                                                                      │
                                          next reads ──► edge cache (warm) ──► SUM leaderboard

## Data Model (Turso / libSQL — SQLite)

Timestamps: ISO 8601 UTC `TEXT` (e.g. `2026-06-25T18:00:00Z`). SQLite has no datetime type — one convention everywhere.

```sql
CREATE TABLE tournament (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE team (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournament(id),
  name TEXT NOT NULL, code TEXT);

CREATE TABLE match (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournament(id),
  home_team_id TEXT NOT NULL REFERENCES team(id),
  away_team_id TEXT NOT NULL REFERENCES team(id),
  kickoff_utc TEXT NOT NULL,                       -- ISO 8601 UTC
  status TEXT NOT NULL CHECK(status IN ('scheduled','in_progress','finished')),
  home_score INTEGER, away_score INTEGER,          -- null until known
  result_source TEXT CHECK(result_source IN ('auto','manual')),
  settled_at TEXT,                                 -- set when points computed
  created_at TEXT NOT NULL
);
CREATE INDEX idx_match_kickoff ON match(kickoff_utc);
CREATE INDEX idx_match_status ON match(status);

CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
  image TEXT, created_at TEXT NOT NULL);  -- Better Auth owns session/account tables

CREATE TABLE prediction (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  match_id TEXT NOT NULL REFERENCES match(id),
  home_goals INTEGER NOT NULL,
  away_goals INTEGER NOT NULL,
  points INTEGER,                                  -- null until settlement
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(user_id, match_id)
);
CREATE INDEX idx_prediction_match ON prediction(match_id);
-- Leaderboard hot path: SUM(points) per user, scoped to a group's members
CREATE INDEX idx_prediction_user_points ON prediction(user_id, points);

CREATE TABLE "group" (id TEXT PRIMARY KEY, name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"(id), created_at TEXT NOT NULL);

CREATE TABLE group_membership (
  group_id TEXT NOT NULL REFERENCES "group"(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_membership_user ON group_membership(user_id);

CREATE TABLE invitation (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES "group"(id),
  token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','revoked')),
  created_at TEXT NOT NULL, expires_at TEXT
);
```

Leaderboard query (per group, tournament total):
`SELECT u.id, SUM(p.points) FROM group_membership gm JOIN prediction p ON p.user_id=gm.user_id JOIN match m ON m.id=p.match_id WHERE gm.group_id=? AND m.tournament_id=? GROUP BY u.id`.

## Scoring (pure function)

```ts
type Score = { home: number; away: number };
function score(pred: Score, result: Score): 0|1|3|4|7 {
  const outcome = (a: Score) => Math.sign(a.home - a.away);          // 1|0|-1
  if (pred.home === result.home && pred.away === result.away) return 7; // pleno
  let pts = 0;
  if (outcome(pred) === outcome(result)) pts += 3;                   // correct W/D/L
  if (pred.home === result.home) pts += 1;                           // exact home goals
  if (pred.away === result.away) pts += 1;                           // exact away goals
  return pts as 0|1|3|4|7;                                           // {0,1,3,4} non-pleno
}
```

Goal bonuses are independent of outcome (rewards being close). Both-goals-exact implies pleno → flat 7 (never 5/6/2). Computed once inside `applyMatchResult` when status becomes `finished`, written to `prediction.points`, `match.settled_at` set.

## Result Ingestion + Triggering

`applyMatchResult(match, score, status, source)` is the only writer of results/points. Behind a per-match DO:
- **Idempotency**: if `match.result_source === 'manual'` and incoming `source === 'auto'` → no-op (manual wins and pins). If already `settled_at` and identical score → no-op.
- **Three triggers** all funnel here: (1) **lazy on-demand** — first viewer after FT calls DO; (2) **safety-net alarm** — DO alarm set at `kickoff_utc + 150min`, fires once, no-op if already settled; (3) **manual admin** — sets `source:'manual'`, pins, forces recompute.
- **Recompute + cache**: on settlement, recompute `points` for all predictions of that match, then invalidate the leaderboard edge cache key(s) touching this tournament. Next reader repopulates warm cache.
- **Adapter normalization**: `ResultSource` adapter converts API kickoff/status payloads to UTC + canonical status on ingest; the domain never sees provider shapes or local times.

`ResultSource` port has two impls: `ApiResultSource` (provider TBD — Football-Data.org vs API-Football, isolated behind the port) and `ManualResultSource` (admin input). Provider choice is a **deploy dependency**, not a code dependency.

## Concurrency / Performance

Match-time read spike is absorbed by: (a) edge-cached leaderboard invalidated only on recompute (points change a few times/day, so ~95% of refreshes hit cache, not Turso); (b) per-match DO single-flight so the first viewer pays the sub-second fetch and all concurrent viewers get no-ops (no thundering herd of N API calls + N recomputes). Free-tier posture: under extreme load the system serves slightly stale cached leaderboards and a "Calculando..." spinner masks the p99 cold-connect tail — it degrades, never collapses.

## Auth

Better Auth with Google OAuth, server sessions stored in own DB. Prediction lock is server-authoritative: reject write if `clock.now() >= match.kickoff_utc - 5min`. Client may disable the stepper at T-5min for UX only; the real gate is server-side against the injected `Clock`, never the client clock.

## Timezones

UTC everywhere server-side (storage, lock math, the +150min alarm, status). Display layer converts via `Intl.DateTimeFormat` with the browser tz and shows a "your local time" label. No hand-rolled tz math; escalate to `date-fns-tz`/Temporal only if `Intl` is insufficient.

## Frontend

TanStack Start (React + Vite SSR on Cloudflare) + Tailwind + shadcn/ui (Radix, own-your-code). TanStack Table powers the responsive leaderboard (mobile cards / desktop rows), TanStack Query for client cache. Drawer/bottom-sheet (Vaul) for "others' predictions" and the lazy H2H panel. Mobile-first, thumb-friendly big +/- score steppers (not dropdowns). Predictions organized by match (proposal pain fix), not by group.

## File Changes (greenfield — illustrative module map)

| Path | Action | Description |
|------|--------|-------------|
| `src/domain/scoring.ts` | Create | Pure `score()` function |
| `src/domain/lock.ts` | Create | Server-authoritative T-5min lock using `Clock` |
| `src/domain/ports/{clock,result-source,repositories}.ts` | Create | Hexagonal ports |
| `src/domain/apply-match-result.ts` | Create | The idempotent choke point |
| `src/adapters/result-source/{api,manual}.ts` | Create | `ResultSource` impls (provider isolated) |
| `src/adapters/db/*` | Create | Turso repository impls |
| `src/workers/match-do.ts` | Create | Per-match Durable Object (single-flight + alarm) |
| `db/migrations/0001_init.sql` | Create | Schema above |
| `src/routes/*` | Create | TanStack Start routes/loaders |
| `src/components/leaderboard/*`, `score-stepper`, `prediction-drawer` | Create | UI |

## Testing Strategy

| Layer | What | Tool |
|-------|------|------|
| Unit | `score()` exhaustive {0,1,3,4,7}; lock rule with injected Clock; idempotency rules | Vitest, in-memory ports |
| Integration | repositories + leaderboard SUM on a local libSQL file; `applyMatchResult` recompute | Vitest + local libSQL |
| Workers runtime | DO single-flight, alarm at kickoff+150min, bindings | @cloudflare/vitest-pool-workers (real workerd) |
| E2E | login (test auth bypass), submit prediction, settle, leaderboard updates | Playwright, mobile viewport projects, seedable DB |
| Ad-hoc | prod verification | Chrome MCP |

Injectable `Clock` makes all time tests deterministic (no real waiting for alarms/locks). E2E is not yet configured (greenfield) — setup is a task.

## Migration / Rollout

Greenfield: forward-only migrations + seed fixtures. First slice (tracer bullet) deployed to a Cloudflare preview before promote. No destructive migrations in MVP; rollback = revert deploy/branch (no prod users).

## Open Questions

- [ ] Football data provider not chosen (Football-Data.org vs API-Football) — **deploy dependency**, isolated by `ResultSource` port; does not block domain/core work.
- [ ] Reminder delivery channel (Web Push vs email) — reuses per-match DO alarm scheduling; out of first slice.
- [ ] Leaderboard cache key granularity (per group vs per tournament) and edge cache mechanism (Cache API vs KV) — confirm during apply.

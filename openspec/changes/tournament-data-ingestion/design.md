# Design: Tournament Data Ingestion (FIFA API)

## Technical Approach

Add a FIFA-backed data layer behind the existing hexagonal ports. Two ports: the existing `ResultSource` (live scores) and a new `TournamentSource` (structure: teams + fixtures + groups). One adapter, `FifaAdapter`, implements both and is the ONLY place the `api.fifa.com` JSON shape exists (anti-corruption layer mapping FIFA -> domain types). Structure import is a one-time idempotent backstage command (upserts via Drizzle `onConflictDoUpdate`) replacing the demo seed. Live results plug into the UNCHANGED settlement path: lazy/alarm/manual triggers all funnel through `applyMatchResult` behind the per-match `MatchDO`. Flags are bundled SVGs keyed by ISO `team.code` (no edge fetch). Provider-swap seam preserved: other `ResultSource` impls + a failover wrapper can be added later without touching the domain.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| 1 | Structure port | New `TournamentSource` port; `FifaAdapter` implements both it and `ResultSource` | Overload `ResultSource` with structure methods | Single-responsibility ports; failover later wraps only `ResultSource`, not structure import |
| 2 | Domain IDs | Store FIFA `IdMatch`/`IdTeam` AS the domain id (prefixed `fifa-m-`/`fifa-t-`) | Random UUIDs + a FIFA-id mapping column | Deterministic ids make import idempotent by PK; no extra join/lookup table |
| 3 | Idempotency | Drizzle `insert().onConflictDoUpdate()` on PK | `INSERT OR IGNORE` (demo) / delete+recreate | Re-run updates changed fields (kickoff, group) without dup rows or losing FKs/predictions |
| 4 | FIFA status map | Explicit table; `3 -> in_progress` confirmed; unknown codes -> safe non-final `scheduled` + flag | Optimistically map unknowns to `finished` | A wrong `finished` settles & locks falsely; safe default never auto-finishes; manual override corrects |
| 5 | Import runner | Backstage script `scripts/import-tournament.ts` (Node, Drizzle, params competition/season) | TanStack server fn / admin route | One-time op, no request context; runs locally/CI with Turso creds; not user-facing |
| 6 | DO->DB live wiring | `MatchDO._doSettle` calls `applyMatchResult` against Turso (completes PR3 stub) | New live-results path bypassing the choke point | Keeps single choke point + single-flight; in_progress drives existing lock |
| 7 | Flags | Bundled `flag-icons` SVGs keyed by ISO `team.code`; `<TeamFlag code>` component | Remote flag CDN / FIFA crest URLs | Edge-safe, offline, no external dependency; placeholder for unmapped codes |
| 8 | FIFA->ISO map | Explicit `fifa-iso.ts` table keyed by FIFA team abbreviation/IdTeam; null placeholder on gap | Trust FIFA `IdCountry`/abbreviation as ISO | FIFA codes are not ISO-3166; explicit map is auditable, admin-correctable |

## Data Flow

    [import-tournament.ts 17/285023]
        FifaAdapter.fetchStructure() ──GET /api/v3/calendar/matches──┐
        (FIFA JSON → domain teams/matches/groups, FIFA→ISO codes)    │
                          │ onConflictDoUpdate (idempotent upsert)   │
                          ▼                                          ▼
                tournament / team(code=ISO) / match  ◄─── api.fifa.com

    [live: viewer hit | DO alarm | admin]
        Worker ─get DO(matchId)─► MatchDO (single-flight)
                                      │ _doSettle
                FifaAdapter.getResult(matchId) ──► MatchResult{status,scores}
                (MatchStatus → canonical; UTC)         │
                                      ▼                 ▼
                          applyMatchResult(domain) ──► score → prediction.points
                          in_progress ──► existing T-5min lock holds

## Interfaces / Contracts

```ts
// src/domain/ports/tournament-source.ts (NEW)
export interface TournamentTeam { id: string; name: string; code: string | null } // code = ISO or null
export interface TournamentMatch {
  id: string; homeTeamId: string; awayTeamId: string;
  kickoffUtc: string; status: "scheduled" | "in_progress" | "finished";
  homeScore: number | null; awayScore: number | null;
  group: string | null; stage: string | null;
}
export interface TournamentStructure {
  tournamentId: string; name: string;
  teams: TournamentTeam[]; matches: TournamentMatch[];
}
export interface TournamentSource {
  fetchStructure(competitionId: string, seasonId: string): Promise<TournamentStructure>;
}
// ResultSource (existing) unchanged — FifaAdapter implements both.
```

FIFA match mapping (in adapter only): `IdMatch -> id`, `Home.IdTeam/Away.IdTeam -> *TeamId`, `Date -> kickoffUtc`, `Home.Score/Away.Score -> *Score`, `GroupName/IdGroup -> group`, `IdStage -> stage`.

### FIFA MatchStatus map (adapter `mapStatus`)

| FIFA code | Canonical | Confidence |
|-----------|-----------|-----------|
| 3 | in_progress | CONFIRMED (POC: live) |
| 0 (TBC) | scheduled | likely upcoming — verify |
| 1 (TBC) | finished | likely full-time — verify |
| 12 (TBC) | scheduled | "to be played" variant — verify |
| any other / unknown | scheduled (SAFE) + `console.warn` flag | default rule |

Safe-default rule: an unmapped code NEVER yields `finished` (no false settle/lock). During apply, empirically query a finished and an upcoming WC2026 match to confirm 0/1/12, then assert the full table in tests.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/domain/ports/tournament-source.ts` | Create | `TournamentSource` port + structure types |
| `src/adapters/result-source/fifa.ts` | Create | `FifaAdapter` (both ports); FIFA JSON isolated; defensive parse; status + UTC normalize |
| `src/adapters/result-source/fifa-iso.ts` | Create | FIFA team -> ISO map table + placeholder lookup |
| `src/adapters/result-source/fifa.test.ts` | Create | Mapping + status-table unit tests against recorded fixtures |
| `src/adapters/result-source/__fixtures__/*.json` | Create | Recorded FIFA JSON (live, finished, upcoming) |
| `src/adapters/tournament-import/import.ts` | Create | Idempotent upsert: tournament/team/match via `onConflictDoUpdate` |
| `src/adapters/tournament-import/import.test.ts` | Create | Import against local libSQL; re-run = no dupes |
| `scripts/import-tournament.ts` | Create | CLI runner (params competition/season; default 17/285023) |
| `src/workers/match-do.ts` | Modify | `_doSettle` calls `applyMatchResult` against Turso (completes wiring) |
| `src/components/team-flag.tsx` | Create | `<TeamFlag code>` renders bundled SVG; placeholder on null |
| `db/seeds/demo.sql` | Delete | Replaced by FIFA structure import |
| `package.json` | Modify | Add `flag-icons` dep + `import:tournament` script |

## Resilience

FIFA is unofficial: adapter sets a fetch timeout (`AbortController`, ~8s), parses defensively (each field guarded; missing/garbage -> skip record + warn, never throw the whole import), and on parse failure of a result degrades to leaving prior state (manual override is the backstop). Structure import is fragility-tolerant by being one-time. Swap seam: future `FootballDataSource`/`ApiFootballSource` implement `ResultSource`; a `FailoverResultSource` wrapper tries primary then fallback — designed now, not implemented.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | FIFA->domain mapping; FIFA->ISO; `mapStatus` full table incl. safe-default | Vitest against recorded `__fixtures__/*.json` — NO live API |
| Integration | Import idempotency (run twice -> no dupes, updates changed fields) | Vitest + local libSQL `:memory:` |
| Workers | `MatchDO` -> `applyMatchResult` live settlement + in_progress lock | `@cloudflare/vitest-pool-workers` (real workerd) |
| Manual/once | Confirm FIFA status codes 0/1/12 | Real `api.fifa.com` query during apply; encode result into table + fixtures |

Only the status-code confirmation needs the real API (one-off, recorded into fixtures). All CI tests use fixtures + local libSQL.

## Migration / Rollout

Forward-only; no prod users. Run `import:tournament 17 285023` once to seed; idempotent re-run safe. Demo seed removed (restorable from git). Rollback = revert deploy; manual override keeps leaderboard correctable if FIFA ingestion fails.

## Open Questions

- [ ] FIFA MatchStatus codes for upcoming/finished (0/1/12?) — confirm empirically during apply; safe-default holds until then.
- [ ] FIFA->ISO coverage for all 48 WC2026 teams — fill map during apply; placeholder flag until corrected.

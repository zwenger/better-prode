# Proposal: Tournament Data Ingestion (FIFA API)

## Intent

The MVP design defined a `ResultSource` port but left the provider unchosen and ran on a demo seed. A POC proved the FIFA undocumented API (api.fifa.com, no auth, free) holds the COMPLETE WC 2026 structure AND returns LIVE scores (verified mid-match: Ecuador 1-1 Germany, 67', MatchStatus 3). This change realizes the original PR-3 slice: a real FIFA-backed data layer (structure seed + live results) plugged behind the existing port, replacing the demo seed and validating the whole pipeline at zero cost. Official providers are deferred (no keys yet).

## Scope

### In Scope
- FIFA API adapter implementing the existing `ResultSource` port + a tournament-structure source, isolating FIFA JSON from the domain.
- Idempotent **tournament structure import**, parameterized by competition/season ids (WC2026: 17 / 285023), seeding teams + matches + groups + kickoffs. Becomes the real seed and the reusable "set up a new tournament" process.
- **Live results ingestion**: normalize FIFA MatchStatus → scheduled/in_progress/finished and Home/Away score, fed through the EXISTING `applyMatchResult` choke point + per-match Durable Object. `in_progress` drives the bet-lock.
- **Flags**: map FIFA team identifiers/abbreviations → ISO code stored on `team.code`; render via a BUNDLED SVG flag set (flag-icons / circle-flags) keyed by ISO — no edge image dependency.
- Hybrid sourcing: FIFA API as free primary; existing manual admin override ("manual wins and pins") as backstop; all timestamps normalized to UTC.

### Out of Scope
- Football-Data.org / API-Football adapters and the `FailoverResultSource` wrapper (deferred until keys exist — only the port + FIFA impl now).
- Reminders / Web Push (separate feature).
- Historical tournaments beyond WC 2026.

## Capabilities

### New Capabilities
- `tournament-import`: idempotent, parameterized seed of teams/matches/groups/kickoffs from a structure source; the reusable new-tournament setup process.
- `team-flags`: ISO code mapping on teams + bundled SVG flag rendering keyed by ISO.

### Modified Capabilities
- `match-results`: add concrete FIFA `ResultSource` adapter + MatchStatus→canonical-status normalization (port contract unchanged; manual-wins-and-pins preserved).

## Approach

Build a FIFA-specific adapter behind the already-designed `ResultSource` port plus a structure source, so the domain never sees FIFA JSON. A first slice delivers the structure import (one-time read, fragility-tolerant) and the FIFA→ISO flag mapping; a second slice wires live results through `applyMatchResult` + the per-match DO and uses `in_progress` for the lock. The port abstraction keeps providers swappable later without touching the domain.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/result-source/fifa.ts` | New | FIFA result + structure adapter; JSON isolation, UTC + status normalization |
| `src/adapters/tournament-import/` | New | Idempotent import seeding teams/matches/groups |
| `src/domain/ports/result-source.ts` | Modified | Confirm/extend port for structure source if needed |
| `src/infra/db/schema.ts` | Modified | Ensure `team.code` (ISO) populated by import |
| `src/components/` + flag assets | New | Bundled SVG flags keyed by ISO |
| demo seed | Removed | Replaced by FIFA structure import |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| FIFA API undocumented — JSON shape changes without notice | Med | Adapter isolates shape; manual override backstop; provider swappable behind port |
| MatchStatus enum incompletely mapped (only 3=live confirmed) | High | Confirm full enum during apply; default unknown codes to a safe state; assert mapping in tests |
| FIFA→ISO mapping gaps for some teams | Med | Maintain explicit mapping table; fall back to placeholder flag; admin can correct |
| Re-running import duplicates rows | Med | Upsert by stable FIFA ids (`onConflictDoUpdate`); idempotent by design |

## Rollback Plan

Forward-only migrations; no prod users. Rollback = revert the deploy/branch. The import is idempotent and re-runnable; the demo seed can be restored from git if the FIFA import misbehaves. The manual override keeps the leaderboard correctable even if FIFA ingestion is fully disabled.

## Dependencies

- Existing `ResultSource` port, `applyMatchResult` choke point, and per-match Durable Object (from world-cup-prode-mvp).
- Drizzle schema with `team.code`.
- Bundled flag asset package (flag-icons or circle-flags).

## Success Criteria

- [ ] Running the import with ids 17/285023 seeds the full WC 2026 teams, fixtures, groups, and UTC kickoffs idempotently.
- [ ] Re-running the import produces no duplicates and updates changed fields.
- [ ] A live match reflects correct status + score via `applyMatchResult`, and `in_progress` locks betting.
- [ ] Every team renders a bundled SVG flag via its ISO `team.code`.
- [ ] No FIFA JSON shape leaks into the domain; manual override still pins over auto.

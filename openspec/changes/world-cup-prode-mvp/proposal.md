# Proposal: World Cup Prode MVP

## Intent

Rebuild prodeenlinea.com as an edge-native World Cup prediction pool that survives match-time traffic spikes within free tiers and never collapses. Fix the original pains: slow + concurrency collapse, no way to see others' bets, prediction entry organized by group/phase instead of by match, no pre-kickoff reminders, slow result updates. Success = users predict per match, compare within groups, and see correct leaderboards seconds after full-time, even under simultaneous-refresh load.

## Scope

### In Scope
- Google-only auth (Better Auth); users stored in own DB.
- One prediction per (user, match) score, shared across all groups; editable until kickoff−5min (server-authoritative lock).
- Group lifecycle: create/join, invite links, accept/reject, approve/remove members, owner/admin/member roles.
- Match-centric, mobile-first UI (Tailwind + shadcn/ui + TanStack Table); big +/- steppers; in-progress view; click a match to see same-group members' frozen predictions.
- Scoring {0,1,3,4,7}: outcome +3, exact goals/team +1 each, pleno = 7; points stored per prediction, computed on settlement.
- Leaderboard: per-match + tournament total, per group; cached, invalidated on recompute.
- Hybrid result ingestion behind an adapter (auto API + manual admin, "manual wins and pins").
- Triggering via one idempotent `applyMatchResult` choke point behind a per-match Durable Object: lazy on-demand (primary) + DO alarm safety-net (~kickoff+150min) + manual admin backstop.
- Pre-kickoff reminders for non-predictors (reuses per-match DO scheduling).
- UTC internally; local display via Intl. Injectable Clock + hexagonal ports/adapters; strict TDD.

### Out of Scope
- Multiple/other tournaments (adapter enables later swap; not built now).
- Live in-play provisional leaderboard (points settle at full-time only).
- Non-Google auth.

## Capabilities

### New Capabilities
- `auth`: Google OAuth sign-in, session, own-DB user records.
- `groups`: create/join, invitations, membership roles, approve/remove.
- `predictions`: per-(user,match) score entry, server-side T−5min lock.
- `scoring`: deterministic {0,1,3,4,7} point computation per prediction.
- `match-results`: ingestion adapter (auto + manual), status + score normalization, "manual wins and pins".
- `result-triggering`: `applyMatchResult` choke point, per-match Durable Object single-flight, lazy + alarm + manual triggers.
- `leaderboard`: cached per-group per-match + total standings, invalidated on recompute.
- `match-views`: match-organized listing, in-progress view, frozen same-group predictions view.
- `reminders`: pre-kickoff notification for non-predictors via DO scheduling.

### Modified Capabilities
None (greenfield).

## Approach

Hexagonal core (domain: Match, Prediction, scoring, lock) with injectable Clock and ports for ResultSource, repositories, scheduling. TanStack Start SSR on Cloudflare; Turso for relational reads (leaderboard = `SUM ... GROUP BY`). One idempotent `applyMatchResult` serialized by a per-match Durable Object solves thundering herd + consistency with a single mechanism. Edge-cached leaderboard absorbs the refresh spike. Build outside-in per the architecture decisions in engram (`architecture/*`).

## First Slice (Tracer Bullet)

Prove the architecture end-to-end with the thinnest vertical slice before breadth:
Google login → seeded single match → submit one prediction (server lock enforced) → `applyMatchResult` via per-match DO (manual + lazy) → scoring computes points → cached single-group leaderboard reflects it. Excludes invitations breadth, reminders, auto API provider, in-progress polish. Validates DO single-flight, Clock injection, scoring, lock, and the cache-invalidate hot path.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/domain/` | New | Scoring, lock rule, Clock port, entities |
| `src/ports/` + `src/adapters/` | New | ResultSource, repositories, scheduler |
| `src/durable-objects/` | New | Per-match single-flight `applyMatchResult` + alarm |
| `src/routes/` (TanStack Start) | New | Match list, prediction, leaderboard, groups, admin |
| `src/db/` (Turso) | New | Schema + migrations + seed fixtures |
| test suites | New | Unit, integration (libSQL), workers-pool, Playwright |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| External football API fragility/outage | Med | Adapter + manual "wins and pins" backstop + DO safety-net alarm |
| Thundering herd recreates collapse | Med | Per-match DO single-flight; edge-cached leaderboard |
| Client clock spoofing to bet post-kickoff | High impact | Server-authoritative lock against server Clock only |
| Free-tier limits exceeded at peak | Low/Med | Cacheable frozen reads (~95%); lazy compute pays cost once |
| Scoring edge errors ({0,1,3,4,7}) | Med | Exhaustive unit tests; strict TDD |

## Rollback Plan

Greenfield: rollback = revert to previous deploy/branch (no production users at MVP). Schema changes are forward migrations with seed fixtures; the first slice ships behind a deploy preview before promoting. No destructive data migration in MVP.

## Dependencies

- Cloudflare account (Pages/Workers/DO/Cron), Turso DB, Google OAuth credentials, a football-data provider API key (Football-Data.org or API-Football).

## Success Criteria

- [ ] User signs in with Google and submits one prediction per match, locked server-side at T−5min.
- [ ] Result settlement via lazy/alarm/manual all funnel through one idempotent DO path (no double compute).
- [ ] Leaderboard updates within seconds of settlement and serves cached reads under simultaneous refresh.
- [ ] Scoring matches {0,1,3,4,7} exhaustively (unit-tested).
- [ ] Groups: create, invite, join, manage members; predictions shared across a user's groups.
- [ ] First slice passes unit + integration + workers-runtime + Playwright (mobile viewport) tests.

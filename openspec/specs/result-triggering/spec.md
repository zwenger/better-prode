# Result Triggering Specification

## Purpose

Governs how and when applyMatchResult is invoked. Four trigger paths (cron reconcile, lazy on-demand, import-time safety-net alarm, manual admin) all funnel through a single idempotent choke point serialized by a per-match Durable Object.

## Requirements

### Requirement: Single applyMatchResult Choke Point

The system MUST funnel ALL result settlement through one function: `applyMatchResult(matchId, score, status, source)`. No code path MAY bypass this function to update match results or compute points directly.

#### Scenario: All trigger paths call the same function

- GIVEN any of the three triggers fires for a match
- WHEN settlement is performed
- THEN it always passes through applyMatchResult with the same interface
- AND the same idempotency, validation, and points-write logic applies regardless of trigger source

### Requirement: Per-Match Durable Object Single-Flight

The system MUST use one Cloudflare Durable Object instance per match to serialize concurrent applyMatchResult calls. If multiple requests arrive simultaneously for the same match, only ONE call to the external API and ONE points-compute runs; subsequent concurrent callers wait for and receive the result of the first.

#### Scenario: Thundering-herd at match end

- GIVEN 100 simultaneous requests arrive for a just-finished match
- WHEN each request triggers applyMatchResult via the per-match DO
- THEN the external API is called exactly once
- AND points are computed exactly once
- AND all 100 requests eventually receive the settled result

#### Scenario: Single-flight for already-settling match

- GIVEN applyMatchResult is already running for match X inside its DO
- WHEN a second concurrent request arrives for match X
- THEN the second request waits (or receives the cached result) without spawning a new settlement

### Requirement: Idempotency of applyMatchResult

applyMatchResult MUST be idempotent: calling it N times with the same (matchId, score, status) MUST produce the same DB state as calling it once. Re-running for a match that is already "finished" with the same result MUST be a no-op.

#### Scenario: Duplicate trigger on settled match

- GIVEN a match already settled with score 2-1 and points written
- WHEN applyMatchResult(matchId, {2,1}, "finished", "auto") is called again
- THEN no DB writes occur
- AND no prediction points are changed

#### Scenario: Re-run with corrected result updates points

- GIVEN a match settled with score 2-1
- WHEN applyMatchResult(matchId, {3-1}, "finished", "manual") is called with a new score
- THEN match result is updated
- AND all prediction points for that match are recomputed and overwritten

### Requirement: Lazy On-Demand Trigger (Primary)

The system MUST trigger applyMatchResult when the first authenticated user views a match (or the leaderboard after a match's expected end time) and the match is not yet settled. This is the primary, lowest-latency trigger.

#### Scenario: First viewer after match end triggers settlement

- GIVEN a match has finished but is not yet settled
- WHEN the first user loads the match view or leaderboard
- THEN the server calls applyMatchResult via the per-match DO
- AND the response waits for settlement (with a loading indicator if necessary)

#### Scenario: Subsequent viewers get cached result

- GIVEN a match is settled (DO has processed it)
- WHEN later users load the same match view
- THEN no new settlement is triggered
- AND the cached result and points are returned immediately

### Requirement: Safety-Net DO Alarm (Consistency)

The system MUST schedule a Durable Object alarm at approximately kickoff + 150 minutes for every match. This alarm fires ONCE and calls applyMatchResult if the match is not yet settled, guaranteeing convergence even if no viewer loaded the match.

#### Scenario: Alarm fires for unsettled match

- GIVEN a match ended but no viewer triggered lazy settlement
- WHEN the per-match DO alarm fires at kickoff + 150min
- THEN applyMatchResult is called
- AND the match is settled

#### Scenario: Alarm is a no-op if already settled

- GIVEN a match was already settled by lazy on-demand trigger
- WHEN the DO alarm fires
- THEN applyMatchResult detects the match is already settled
- AND no API call and no point recompute occurs

#### Scenario: Alarm fires exactly once per match

- GIVEN a match's DO alarm is set
- WHEN the alarm fires
- THEN it does NOT reschedule itself
- AND the match's alarm state is cleared

### Requirement: Cron Reconcile with Dynamic Active-Window Gating

The system MUST run a recurring scheduled job that polls the external result source for matches that have kicked off and are not yet settled, and settles them via the existing `applyMatchResult` choke point. The job MUST be dynamic: it MUST query the DB first to determine whether any active-window matches exist (kicked off, not yet `finished`); only when at least one such match exists SHALL it call the external API. When no active-window matches exist the job MUST be a near-noop (no external API call, negligible CPU).

One-time backfill of currently stuck matches is an operational consequence: the first cron run (or manual reconcile) over the stuck matches settles them; no separate permanent mechanism is required.

Testability: the active-window gating predicate (DB query → boolean) is unit-testable in isolation.

#### Scenario: Finished match flipped and settled by cron

- GIVEN a match has kicked off and the external source reports it `finished`
- AND the DB still has that match as `scheduled` (stuck)
- WHEN the cron job fires
- THEN the job detects the match in the active window
- AND calls the external API to retrieve the result
- AND routes settlement through `applyMatchResult` via the per-match DO
- AND the match is updated to `finished` with points written

#### Scenario: No active matches — no external API call

- GIVEN no match in the DB satisfies (kicked-off AND not finished)
- WHEN the cron job fires
- THEN the job does NOT call the external API
- AND completes with negligible work

#### Scenario: Idempotent re-run settles nothing new

- GIVEN all active-window matches are already settled
- WHEN the cron job fires again
- THEN `applyMatchResult` receives calls that are no-ops (idempotency from existing spec)
- AND no match state or points change

---

### Requirement: Import-Time Safety-Net Alarm Scheduling

When a match is imported or created, the system MUST schedule the per-match DO alarm (at approximately kickoff + 150 minutes) at that moment, so the safety-net alarm fires even if cron and on-demand refresh never run for that match. Alarm scheduling MUST be idempotent: re-importing or re-creating the same match MUST NOT create duplicate alarms.

Testability: alarm scheduling call at import time is unit-testable (stub the DO alarm API, assert it is called with the correct deadline per match).

#### Scenario: Alarm scheduled on match import

- GIVEN a match is being imported into the DB for the first time
- WHEN the import completes
- THEN the per-match DO alarm is set to fire at kickoff + 150 min
- AND no alarm pre-exists for this match before the import

#### Scenario: Alarm fires for an unsettled past match

- GIVEN a match's DO alarm fires at kickoff + 150 min
- AND the match is not yet settled
- WHEN the alarm handler runs
- THEN it polls the external source and routes through `applyMatchResult` via the DO
- AND the match is settled

#### Scenario: Alarm is a no-op if already settled

- GIVEN a match was already settled before the alarm fires
- WHEN the alarm handler runs
- THEN `applyMatchResult` detects the match is already `finished` (existing idempotency)
- AND no API call or point recompute occurs

#### Scenario: Re-import does not duplicate the alarm

- GIVEN a match already has a scheduled DO alarm
- WHEN the same match is imported again (or import is retried)
- THEN only one alarm remains scheduled for the match

---

### Requirement: On-Demand FIFA-Polling Refresh on App Entry (Throttled)

When an authenticated user loads the app or match views, the system SHOULD trigger a background poll of the external result source for matches that are overdue and unsettled (kicked off but not yet `finished`), without blocking page render. The poll MUST be deduplicated via a short-TTL throttle key so that bursts of concurrent users do not produce concurrent external API calls. If the background poll fails, the page MUST still render normally.

Testability: the throttle deduplication predicate (TTL key present → skip) is unit-testable in isolation.

#### Scenario: First viewer in the throttle window triggers a background poll

- GIVEN one or more matches are overdue and unsettled
- AND no throttle key is active for the current window
- WHEN the first authenticated user loads the matches view
- THEN a background poll is initiated (non-blocking)
- AND a throttle key is written with a short TTL
- AND the page renders without waiting for the poll result

#### Scenario: Subsequent viewers within the throttle window do not poll

- GIVEN a throttle key is active (first viewer already triggered a poll)
- WHEN additional authenticated users load the matches view within the TTL window
- THEN no new external API call is made
- AND their pages render normally

#### Scenario: Poll failure does not break page render

- GIVEN the background poll to the external source fails (timeout, error)
- WHEN the poll completes with an error
- THEN the page has already rendered successfully (non-blocking)
- AND no error is surfaced to the user for the background failure
- AND the unsettled match remains unsettled until the next poll opportunity

---

### Requirement: Manual Admin Trigger (Backstop)

An admin MUST be able to trigger a full reconcile on demand at any time via an admin-only interface. The reconcile MUST actively poll the external result source (same as cron reconcile) and route results through `applyMatchResult` for all overdue unsettled matches. The admin interface MUST enforce the existing `ADMIN_USER_IDS` guard — unauthenticated or non-admin callers MUST be rejected. This mechanism also serves as the operational backstop for one-time backfill of stuck matches.
(Previously: the requirement stated an admin can manually trigger settlement for "any match"; this delta makes the trigger a full active-source reconcile — not just applying a known result — and explicitly requires the admin-only auth guard.)

#### Scenario: Admin triggers manual reconcile

- GIVEN an admin is authenticated (present in `ADMIN_USER_IDS`)
- WHEN they trigger reconcile via the admin interface
- THEN the system polls the external source for all overdue unsettled matches
- AND routes each result through `applyMatchResult` via the per-match DO
- AND points are computed or recomputed

#### Scenario: Non-admin request is rejected

- GIVEN a user not present in `ADMIN_USER_IDS` calls the reconcile endpoint
- WHEN the request is processed
- THEN the system returns an authorization error
- AND no reconcile or settlement runs

#### Scenario: Admin reconcile is idempotent

- GIVEN all matches are already settled
- WHEN an admin triggers reconcile
- THEN `applyMatchResult` calls are no-ops (existing idempotency)
- AND no match state or points change

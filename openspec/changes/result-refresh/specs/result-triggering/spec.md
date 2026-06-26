# Delta for result-triggering

> References: existing spec at `openspec/changes/archive/2026-06-26-world-cup-prode-mvp/specs/result-triggering/spec.md`
> All settlement MUST still pass through the existing `applyMatchResult` choke point via the per-match DO — do NOT re-specify those; they hold unchanged.

## ADDED Requirements

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

## MODIFIED Requirements

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

# Result Triggering Specification

## Purpose

Governs how and when applyMatchResult is invoked. Three trigger paths (lazy on-demand, safety-net alarm, manual admin) all funnel through a single idempotent choke point serialized by a per-match Durable Object.

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

### Requirement: Manual Admin Trigger (Backstop)

An admin MUST be able to manually trigger settlement for any match at any time. This covers API failures, provider outages, and time-sensitive corrections.

#### Scenario: Admin triggers settlement manually

- GIVEN an admin is authenticated
- WHEN they submit a result for a match via the admin interface
- THEN applyMatchResult is called with source "manual"
- AND points are computed or recomputed immediately

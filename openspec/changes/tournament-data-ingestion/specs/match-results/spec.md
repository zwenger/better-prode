# Delta for Match Results

## ADDED Requirements

### Requirement: FIFA API ResultSource Adapter

The system MUST provide a concrete implementation of the ResultSource port that fetches live
match results from the FIFA unofficial API (api.fifa.com). The adapter MUST fully isolate the
FIFA JSON shape from the domain; no FIFA-specific field names, status codes, or payload structures
SHALL leak past the adapter boundary.

#### Scenario: Adapter fetches a finished match

- GIVEN a match id and the FIFA adapter configured as the active ResultSource
- WHEN fetchResult is called for that match id
- THEN the adapter returns { homeGoals, awayGoals, status: "finished", source: "auto" }
- AND the response contains no FIFA-specific field names

#### Scenario: Adapter fetches an in-progress match

- GIVEN a live match is ongoing (FIFA MatchStatus = 3)
- WHEN fetchResult is called
- THEN the adapter returns { status: "in_progress", homeGoals: <current>, awayGoals: <current>, source: "auto" }

#### Scenario: FIFA JSON shape change causes parse failure

- GIVEN the FIFA API returns a response with an unrecognized structure (shape change)
- WHEN the adapter attempts to parse it
- THEN the adapter returns a structured error (does not return a "finished" status)
- AND the failure is surfaced to the caller (logged / reported)
- AND the manual override path remains operational

#### Scenario: FIFA API is unreachable

- GIVEN the FIFA API endpoint returns a network error or non-200 response
- WHEN fetchResult is called
- THEN the adapter returns a structured error, not a fabricated result
- AND the manual admin override path can still pin the correct result

### Requirement: FIFA MatchStatus Normalization

The FIFA adapter MUST maintain an explicit mapping table from FIFA MatchStatus integer codes to
the canonical status set: "scheduled" | "in_progress" | "finished". Any status code NOT present
in the mapping table MUST default to "scheduled" (the safe state — does not trigger settlement
or lock predictions prematurely). Unknown codes MUST be surfaced in the adapter output and MUST
NOT be silently treated as "finished".

#### Scenario: Known live status code maps correctly

- GIVEN FIFA returns MatchStatus = 3 (confirmed live)
- WHEN the adapter normalizes it
- THEN canonical status is "in_progress"

#### Scenario: Known finished status code maps correctly

- GIVEN FIFA returns a MatchStatus value that is in the mapping table as finished (e.g. 0, confirmed during apply)
- WHEN the adapter normalizes it
- THEN canonical status is "finished"

#### Scenario: Unknown status code defaults to safe state

- GIVEN FIFA returns a MatchStatus value with no entry in the mapping table
- WHEN the adapter normalizes it
- THEN canonical status is "scheduled"
- AND the unknown code is surfaced (logged / included in adapter result metadata)
- AND settlement is NOT triggered

#### Scenario: In-progress status locks predictions

- GIVEN a match's canonical status transitions to "in_progress" via the FIFA adapter
- WHEN the domain processes this result
- THEN the prediction lock rule fires (same as existing kickoff-based lock — betting is closed)

#### Scenario: Finished status triggers settlement via existing choke point

- GIVEN a match's canonical status is "finished" with a valid score
- WHEN applyMatchResult is called (via the existing choke point and per-match Durable Object)
- THEN prediction points are computed and stored
- AND the leaderboard cache is invalidated
- AND the existing "manual wins and pins" rule is respected (manual pin blocks this write)

### Requirement: FIFA as Primary Free Source with Manual Backstop

FIFA MUST be configured as the primary (free) result source. The existing manual admin override
("manual wins and pins") MUST remain fully operational as a backstop regardless of FIFA adapter
health. The ResultSource port MUST remain provider-agnostic; official providers (Football-Data.org,
API-Football) are deferred and require no code changes to plug in when keys become available.

#### Scenario: Manual pin overrides FIFA result

- GIVEN a match has been pinned by the admin (source = "manual")
- WHEN the FIFA adapter returns a different score for that match
- THEN the manual result is preserved
- AND the FIFA result is discarded (existing "manual wins and pins" rule applies)

#### Scenario: FIFA adapter disabled, manual path still works

- GIVEN the FIFA adapter is not configured or returns errors for all matches
- WHEN an admin submits a manual result
- THEN the result is stored and triggers applyMatchResult normally
- AND the leaderboard reflects the manually entered result

## MODIFIED Requirements

### Requirement: ResultSource Adapter Abstraction

The system MUST expose a ResultSource port (interface) with at minimum one method:
`fetchResult(matchId) -> { homeGoals, awayGoals, status, source }`. Both the external API adapter
and the manual admin entry path MUST implement this interface. The domain MUST NOT depend on a
concrete provider. The FIFA adapter is the first concrete non-manual implementation of this port.
(Previously: "external API adapter" was a placeholder with no concrete implementation.)

#### Scenario: Auto adapter returns result

- GIVEN a match id and an external API adapter configured
- WHEN fetchResult is called
- THEN the adapter returns normalized { homeGoals, awayGoals, status, source: "auto" }
- AND kickoff timestamps are normalized to UTC

#### Scenario: Swapping providers does not change domain behavior

- GIVEN the external API provider is replaced with a different implementation of ResultSource
- WHEN fetchResult is called with the same match id
- THEN the domain receives the same normalized shape and behaves identically

#### Scenario: FIFA adapter is one concrete implementation

- GIVEN the FIFA adapter implements ResultSource
- WHEN it is swapped for a Football-Data.org or API-Football adapter in the future
- THEN no domain code changes are required

### Requirement: Match Status Normalization

The adapter MUST normalize match status to one of three canonical values: "scheduled",
"in_progress", or "finished". Status drives the prediction lock and triggers settlement.
The FIFA adapter MUST use an explicit mapping table; unknown codes MUST default to "scheduled"
(safe state) and MUST be surfaced, not silently ignored.
(Previously: normalization was described generically; unknown-code behavior was unspecified.)

#### Scenario: Status normalized on ingest

- GIVEN a provider returns a proprietary status code (e.g. FIFA integer 3)
- WHEN the adapter processes it
- THEN the match record holds one of "scheduled" | "in_progress" | "finished"

#### Scenario: Unknown status code is safe

- GIVEN the adapter encounters an unrecognized status code
- WHEN it normalizes the status
- THEN the canonical status is "scheduled"
- AND the code is surfaced (not silently discarded)

#### Scenario: Status transition to finished triggers settlement

- GIVEN a match transitions to "finished" with a valid score
- WHEN the adapter delivers this status
- THEN applyMatchResult is called with the final score and status "finished"

## Non-Goals

- Football-Data.org adapter implementation (deferred until keys available).
- API-Football adapter implementation (deferred until keys available).
- FailoverResultSource / multi-provider chaining (deferred).
- Admin UI for triggering result ingestion.
- Reminder / Web Push notifications (separate change).

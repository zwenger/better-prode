# Leaderboard Specification

## Purpose

Governs leaderboard computation, caching, and display. Leaderboards show per-match points and tournament totals, scoped to a group.

## Requirements

### Requirement: Per-Group Leaderboard

The system MUST display a leaderboard scoped to a group, showing each member's total points for the tournament and optionally their points per match.

#### Scenario: Group leaderboard loaded

- GIVEN an authenticated user who is a member of group G
- WHEN they view the leaderboard for group G
- THEN they see each group member ranked by total tournament points (SUM of Prediction.points for settled matches)
- AND ties are broken deterministically (e.g. alphabetically by display name)

#### Scenario: User in multiple groups sees separate leaderboards

- GIVEN a user is a member of group A and group B
- WHEN they view group A's leaderboard
- THEN they see only group A's members ranked
- AND group B's leaderboard is separate

### Requirement: Points Derived from Stored Prediction.points

Leaderboard totals MUST be computed as `SELECT SUM(points) FROM predictions WHERE user_id = ? AND match_id IN (settled matches)` — or equivalent aggregation — using stored points values. The scoring function MUST NOT be re-invoked at leaderboard read time.

#### Scenario: Leaderboard read is a SUM aggregation

- GIVEN multiple settled matches with stored points
- WHEN the leaderboard is queried
- THEN totals reflect SUM(Prediction.points) for each user in the group

### Requirement: Leaderboard Cache Invalidation

The leaderboard result MUST be cached at the edge. The cache MUST be invalidated whenever applyMatchResult completes and writes new point values.

#### Scenario: Cache invalidated on settlement

- GIVEN a match is settled and points are written
- WHEN applyMatchResult completes
- THEN the leaderboard cache for all groups containing users with predictions on that match is invalidated
- AND the next leaderboard request re-derives totals from the DB

#### Scenario: Simultaneous refresh spike absorbed by cache

- GIVEN the leaderboard cache is populated after settlement
- WHEN 100 users simultaneously request the leaderboard
- THEN only one DB query (or cache miss) occurs; all others are served from edge cache

### Requirement: Per-Match Points Visibility

The system MUST allow users to see how many points each group member earned on a specific match, in addition to the tournament total.

#### Scenario: Per-match breakdown visible

- GIVEN a settled match and a group with members who have predictions
- WHEN a user views the match detail
- THEN they see each group member's points for that match alongside the predictions

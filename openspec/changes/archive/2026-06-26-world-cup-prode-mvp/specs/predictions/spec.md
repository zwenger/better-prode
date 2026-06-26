# Predictions Specification

## Purpose

Governs creation, editing, and locking of match predictions. One prediction per (user, match) is shared across all groups.

## Requirements

### Requirement: One Prediction Per User Per Match

The system MUST enforce a unique constraint of one prediction per (user, match) pair. A prediction is shared across all groups the user belongs to; groups are a comparison lens, not prediction owners.

#### Scenario: First prediction submission

- GIVEN an authenticated user has no prediction for a match
- WHEN they submit a score prediction (homeGoals, awayGoals)
- THEN a new prediction record is created for (user, match)
- AND the prediction is immediately visible in all groups the user belongs to

#### Scenario: Duplicate submission rejected at DB level

- GIVEN a prediction already exists for (user, match)
- WHEN a second INSERT for the same pair is attempted
- THEN the DB constraint rejects it with a unique-violation error

### Requirement: Prediction Editability Until Lock

The system MUST allow a user to update their prediction for a match until the server-authoritative lock time (kickoff − 5 minutes). After that time the prediction MUST be frozen and any update request MUST be rejected by the server.

#### Scenario: Update before lock time

- GIVEN a prediction exists and the server clock shows now < kickoff − 5min
- WHEN the user submits an updated score
- THEN the prediction is updated and the new values are stored

#### Scenario: Update rejected at lock time (server-authoritative)

- GIVEN the server clock shows now >= kickoff − 5min
- WHEN an update request arrives for that match's prediction
- THEN the server rejects the request with HTTP 422 and reason "match_locked"
- AND the prediction is NOT modified

#### Scenario: Client clock manipulation cannot bypass lock

- GIVEN a user sets their device clock to a time before kickoff − 5min
- WHEN they submit a prediction update after the real server time has passed the lock
- THEN the server rejects the request because the server clock is authoritative
- AND the client-side lock UI state is irrelevant to this outcome

#### Scenario: Submission after lock (no prior prediction)

- GIVEN a user has no prediction for a match and the lock time has passed
- WHEN they attempt to submit a prediction
- THEN the server rejects the request with HTTP 422 and reason "match_locked"
- AND no prediction record is created

### Requirement: Prediction Lock Is Server-Authoritative

The lock check MUST be performed on the server against the server clock. The client MAY disable UI controls at T−5min as a UX affordance, but this does NOT constitute the authoritative check.

#### Scenario: Server rejects even if client sends valid-looking request

- GIVEN the lock time has passed
- WHEN a crafted HTTP request is sent directly to the prediction endpoint (bypassing client UI)
- THEN the server evaluates its own clock against kickoff − 5min and rejects if locked

### Requirement: Prediction Data Model

A prediction record MUST contain: id, user_id, match_id, predicted_home_goals (integer >= 0), predicted_away_goals (integer >= 0), created_at (UTC), updated_at (UTC), and points (nullable integer, populated on settlement).

#### Scenario: Goals are non-negative integers

- GIVEN a user submits a prediction
- WHEN either goal value is negative or non-integer
- THEN the server rejects with HTTP 400

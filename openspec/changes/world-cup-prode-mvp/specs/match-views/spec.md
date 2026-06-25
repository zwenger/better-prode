# Match Views Specification

## Purpose

Governs the match-centric UI: the list of in-progress/upcoming matches, prediction entry, and the view of same-group members' frozen predictions after kickoff.

## Requirements

### Requirement: Match List Organized by Match

The system MUST present matches organized by match (not by group or phase). Matches MUST show status (scheduled, in-progress, finished), kickoff time in the user's local timezone, and the user's own prediction if one exists.

#### Scenario: User views match list

- GIVEN an authenticated user
- WHEN they view the main matches screen
- THEN they see matches listed with status, local kickoff time (via Intl), and their prediction for each match (or an "add prediction" affordance if none exists)

#### Scenario: In-progress matches surface prominently

- GIVEN one or more matches are in-progress
- WHEN the user views the match list
- THEN in-progress matches are visually distinguished and listed first or in a dedicated section

### Requirement: Prediction Entry UI

Prediction entry MUST use large +/− steppers for goal values (thumb-reachable on mobile). The form MUST be disabled and show a locked state once the server lock time has passed (kickoff − 5min), as a UX affordance. The server-side lock is authoritative.

#### Scenario: Prediction entry before lock

- GIVEN a match is not yet locked (server time < kickoff − 5min)
- WHEN the user views the match
- THEN +/− steppers for home and away goals are active and submission is available

#### Scenario: Prediction entry locked in UI after T−5min

- GIVEN the client detects the lock time has passed (server-provided kickoff time)
- WHEN the user views the match
- THEN the steppers are disabled and a "locked" indicator is shown
- AND the server will also reject any submission (as per predictions spec)

### Requirement: See Same-Group Members' Frozen Predictions

After the prediction lock time, authenticated users MUST be able to view the frozen predictions of all members across all of their groups for a given match.

#### Scenario: View others' predictions for a settled/locked match

- GIVEN a match is locked or finished
- WHEN a user taps/clicks on the match
- THEN a panel (drawer on mobile) opens showing each same-group member's predicted score and points earned (if settled)

#### Scenario: Predictions are frozen in the view

- GIVEN a match has been settled
- WHEN a user views the predictions panel
- THEN predictions are displayed as read-only; no edit controls are shown

#### Scenario: Predictions hidden before lock

- GIVEN a match is not yet locked
- WHEN a user attempts to view others' predictions
- THEN the system MUST NOT reveal other users' predictions
- AND the panel either does not open or shows a "predictions hidden until kickoff" message

### Requirement: Timezone Display

All kickoff times displayed to users MUST be converted from UTC to the user's browser timezone using Intl.DateTimeFormat. The display MUST include a timezone label or indication to avoid ambiguity.

#### Scenario: Kickoff shown in user's local time

- GIVEN a match kickoff stored as UTC
- WHEN the user views the match list or detail
- THEN the displayed time reflects their browser's local timezone
- AND a timezone identifier or "your local time" label is shown

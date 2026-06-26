# Match Results Specification

## Purpose

Governs how match results (scores and status) enter the system via a source-abstracted adapter, and the "manual wins and pins" rule that prevents automatic overwrites of admin-confirmed data.

## Requirements

### Requirement: ResultSource Adapter Abstraction

The system MUST expose a ResultSource port (interface) with at minimum one method: `fetchResult(matchId) -> { homeGoals, awayGoals, status, source }`. Both the external API adapter and the manual admin entry path MUST implement this interface. The domain MUST NOT depend on a concrete provider.

#### Scenario: Auto adapter returns result

- GIVEN a match id and an external API adapter configured
- WHEN fetchResult is called
- THEN the adapter returns normalized { homeGoals, awayGoals, status, source: "auto" }
- AND kickoff timestamps are normalized to UTC

#### Scenario: Swapping providers does not change domain behavior

- GIVEN the external API provider is replaced with a different implementation of ResultSource
- WHEN fetchResult is called with the same match id
- THEN the domain receives the same normalized shape and behaves identically

### Requirement: Manual Admin Result Entry

A single global admin MUST be able to enter or correct a match result via the admin interface. Manual entry MUST set match source to "manual".

#### Scenario: Admin submits a result

- GIVEN the admin is authenticated and a match exists
- WHEN they submit { homeGoals, awayGoals } for the match
- THEN the match result is updated and source is set to "manual"
- AND applyMatchResult is triggered with source "manual"

#### Scenario: Admin corrects a previously settled result

- GIVEN a match is settled with source "auto"
- WHEN the admin submits a corrected result
- THEN the match result and source are updated
- AND applyMatchResult re-runs, recomputing and overwriting all prediction points

### Requirement: Manual Wins and Pins

When source is "manual", automatic result ingestion MUST NOT overwrite the match result. A "manual" flag on the match pins it against auto updates.

#### Scenario: Auto ingestion blocked when manual pin is set

- GIVEN a match has source "manual"
- WHEN the automatic ingestion adapter attempts to write a result for the same match
- THEN the write is rejected
- AND the manual result and points remain unchanged

#### Scenario: Auto ingestion proceeds when no manual pin

- GIVEN a match has no result or source "auto"
- WHEN the automatic adapter provides a new result
- THEN the match result is updated and applyMatchResult is triggered normally

### Requirement: Match Status Normalization

The adapter MUST normalize match status to one of three canonical values: "scheduled", "in-progress", or "finished". Status drives the prediction lock (kickoff) and triggers settlement (finished).

#### Scenario: Status normalized on ingest

- GIVEN a provider returns a proprietary status string (e.g. "LIVE" or "FT")
- WHEN the adapter processes it
- THEN the match record holds one of "scheduled" | "in-progress" | "finished"

#### Scenario: Status transition to finished triggers settlement

- GIVEN a match transitions to "finished" with a valid score
- WHEN the adapter delivers this status
- THEN applyMatchResult is called with the final score and status "finished"

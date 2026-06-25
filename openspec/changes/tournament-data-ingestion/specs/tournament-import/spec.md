# Tournament Import Specification

## Purpose

Governs idempotent seeding of tournament structure (teams, matches, groups, kickoff times) from
an external source into the database. Designed as a reusable backstage command parameterized by
competition/season identifiers; first use targets WC 2026 (idCompetition=17, idSeason=285023).

## Requirements

### Requirement: Idempotent Structure Import

The system MUST provide an import command that, given a competition id and season id, upserts
teams, matches, groups, and kickoff times (UTC) into the database using the provider's stable
external ids as conflict keys. Re-running the command MUST NOT duplicate rows, and MUST update
changed fields (e.g. a rescheduled kickoff).

#### Scenario: First-run seeds all structure

- GIVEN the database has no teams or matches for the target tournament
- WHEN the import command runs with idCompetition=17 and idSeason=285023
- THEN all teams, all fixtures, their group assignments, and their UTC kickoff times are written
- AND each match record has status "scheduled" and null scores

#### Scenario: Re-run is idempotent

- GIVEN the import has already run successfully
- WHEN the command runs again with the same competition/season ids
- THEN no duplicate rows are created
- AND no existing result data (scores, settled status) is overwritten

#### Scenario: Re-run updates a changed kickoff

- GIVEN a match was previously imported with kickoff T
- WHEN the provider returns that same match with a rescheduled kickoff T'
- THEN the match record reflects T' after the re-run
- AND result fields (home_score, away_score, status if already settled) are left unchanged

#### Scenario: Partial import on provider error

- GIVEN the import is fetching pages of matches and the provider becomes unreachable mid-run
- WHEN the command cannot retrieve a page
- THEN already-fetched rows committed to the DB are preserved
- AND the command reports the failure without rolling back successful writes
- AND re-running the command resumes and fills in the missing data

#### Scenario: Import is reusable for future tournaments

- GIVEN a different competition id and season id (not WC 2026)
- WHEN the import command runs with those ids
- THEN teams and fixtures for that competition are seeded into the database without modifying WC 2026 data

### Requirement: Team Code (ISO) Mapping

The import MUST populate team.code with a two-letter ISO 3166-1 alpha-2 country code derived from
the provider's team identifier or abbreviation. The mapping MUST be maintained as an explicit
lookup table within the adapter. Teams that cannot be mapped MUST be stored with a null or empty
code, MUST NOT cause the import to fail, and MUST be surfaced in the import report.

#### Scenario: Known team maps to ISO code

- GIVEN the provider returns a team identified as "USA" or "United States"
- WHEN the import processes that team
- THEN team.code is set to "US"

#### Scenario: Unknown team id does not fail the import

- GIVEN the provider returns a team whose identifier has no entry in the mapping table
- WHEN the import processes that team
- THEN team.code is stored as null (or empty string)
- AND the import completes successfully
- AND the unmapped team is listed in the command output

### Requirement: UTC Normalization for Kickoffs

All kickoff times MUST be stored in UTC. The adapter MUST convert any provider-supplied timestamps
to UTC before writing to the database. No local or ambiguous timezone representations SHALL be
stored.

#### Scenario: Provider timestamp is UTC ISO 8601

- GIVEN the provider returns a kickoff as "2026-06-11T18:00:00Z"
- WHEN the import writes the match
- THEN match.kickoff_utc stores "2026-06-11T18:00:00Z" verbatim

#### Scenario: Provider timestamp includes offset

- GIVEN the provider returns a kickoff with a non-UTC offset (e.g. "2026-06-11T13:00:00-05:00")
- WHEN the import writes the match
- THEN match.kickoff_utc stores the equivalent UTC value "2026-06-11T18:00:00Z"

### Requirement: Demo Seed Replacement

The FIFA structure import MUST replace the demo/fixture seed as the canonical data source for
tournament structure. The demo seed MUST NOT be run in production once a real import has been
executed. The import is the authoritative backstage setup command for new tournaments.

#### Scenario: Demo seed superseded

- GIVEN the import has run and seeded real WC 2026 data
- WHEN the application runs in production
- THEN the demo seed data is not present (or is entirely overwritten by real data)

## Non-Goals

- Admin UI for triggering the import (backstage command only in this change).
- Historical tournament imports beyond WC 2026.
- Importing player-level data.
- Football-Data.org or API-Football adapters (deferred until keys are available).

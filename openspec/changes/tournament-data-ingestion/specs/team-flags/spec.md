# Team Flags Specification

## Purpose

Governs how country flags are displayed for teams. Flags MUST be rendered from a bundled SVG
asset set keyed by the team's ISO 3166-1 alpha-2 code; no external image requests are permitted.

## Requirements

### Requirement: Bundled SVG Flag Rendering

The system MUST render each team's flag using a bundled SVG set (e.g., flag-icons or circle-flags)
keyed by team.code (ISO 3166-1 alpha-2). The flag asset MUST be part of the application bundle;
no runtime request to an external CDN or image service is permitted for flag display.

#### Scenario: Team has a valid ISO code

- GIVEN a team record has team.code = "BR"
- WHEN the team is rendered in any view (match list, leaderboard, prediction UI)
- THEN the Brazilian flag SVG from the bundled asset set is displayed

#### Scenario: No external image request is made

- GIVEN the application runs with no internet access to external image hosts
- WHEN a page containing team flags is rendered
- THEN all flags display correctly from the bundle with no network errors

### Requirement: Missing or Unmapped Code Fallback

When a team's ISO code is null, empty, or has no corresponding entry in the bundled flag set,
the system MUST display a neutral placeholder (e.g., a generic flag outline or a country-code
badge). The placeholder MUST be visually distinct from a real flag. The missing code MUST NOT
cause a rendering error or broken image.

#### Scenario: Team code is null after import

- GIVEN a team was imported with team.code = null (unmapped)
- WHEN the team is rendered
- THEN a neutral placeholder is displayed instead of a flag
- AND no error is thrown

#### Scenario: Team code has no bundled asset entry

- GIVEN a team has team.code = "XX" which is not present in the bundled SVG set
- WHEN the team is rendered
- THEN the neutral placeholder is displayed
- AND no broken-image indicator appears

### Requirement: Admin Correction of ISO Code

An admin MUST be able to update team.code for any team via the existing admin interface. After
correction, the flag renders correctly on the next page load without requiring a re-import.

#### Scenario: Admin corrects an unmapped team code

- GIVEN a team has team.code = null and displays the placeholder
- WHEN the admin sets team.code = "MX" via the admin interface
- THEN the team's flag renders as the Mexican flag on the next render

## Non-Goals

- Animated or premium flag variants.
- Player-level flag display.
- Admin UI for bulk re-mapping codes (admin corrects individually via existing admin interface).

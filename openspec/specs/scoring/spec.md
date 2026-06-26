# Scoring Specification

## Purpose

Defines the exact point-calculation rules for a prediction against a settled match result. Scoring is a pure, deterministic function with no side effects.

## Requirements

### Requirement: Scoring Rules — Achievable Point Set {0, 1, 3, 4, 7}

The system MUST compute points for a prediction according to these rules, applied in order:

1. **Pleno (exact score)**: predicted_home == actual_home AND predicted_away == actual_away → **7 points** (overrides all additive rules).
2. **Correct outcome**: predicted outcome (W/D/L from the home team's perspective) matches actual outcome → **+3 points**.
3. **Exact home goals**: predicted_home == actual_home → **+1 point** (independent of outcome).
4. **Exact away goals**: predicted_away == actual_away → **+1 point** (independent of outcome).

Rules 2-4 are additive. Rule 1 is a flat override. The achievable totals are exactly **{0, 1, 3, 4, 7}**. Totals 2, 5, 6 are impossible by construction.

#### Scenario: Pleno (exact score)

- GIVEN prediction 2-1, result 2-1
- WHEN points are computed
- THEN points = 7

#### Scenario: Correct outcome only

- GIVEN prediction 2-0, result 1-0 (home win in both)
- WHEN points are computed
- THEN points = 3 (outcome correct, no goals exact)

#### Scenario: Correct outcome + one exact goal

- GIVEN prediction 2-1, result 3-1 (home win; away goal exact)
- WHEN points are computed
- THEN points = 4 (outcome +3, away goal +1)

#### Scenario: Correct outcome + both goals exact equals pleno

- GIVEN prediction 2-1, result 2-1
- WHEN points are computed
- THEN points = 7 (pleno flat override, not 3+1+1=5)

#### Scenario: One exact goal, wrong outcome

- GIVEN prediction 1-0, result 1-2 (away win; home goal exact)
- WHEN points are computed
- THEN points = 1 (only home goal exact; outcome wrong)

#### Scenario: No match

- GIVEN prediction 3-0, result 1-2
- WHEN points are computed
- THEN points = 0

#### Scenario: Draw outcome correct

- GIVEN prediction 1-1, result 2-2 (draw in both)
- WHEN points are computed
- THEN points = 3 (outcome correct, no goals exact)

#### Scenario: Draw pleno

- GIVEN prediction 0-0, result 0-0
- WHEN points are computed
- THEN points = 7

### Requirement: Scoring Is a Pure Function

The scoring function MUST be a pure, side-effect-free function that accepts (predictedHome, predictedAway, actualHome, actualAway) and returns an integer in {0,1,3,4,7}. It MUST NOT perform I/O, call external services, or depend on mutable state.

#### Scenario: Same inputs always produce same output

- GIVEN the scoring function is called with identical arguments at different times
- WHEN evaluated
- THEN the return value is identical each time

### Requirement: Points Stored Per Prediction on Settlement

The system MUST store the computed points value on the Prediction record (Prediction.points) when a match is settled. Leaderboard totals MUST be derived from stored points, not recomputed on every read.

#### Scenario: Points written on settlement

- GIVEN a match transitions to "finished" with a confirmed result
- WHEN applyMatchResult runs
- THEN every Prediction for that match has its points field populated with the computed integer

#### Scenario: Points reflect manual result correction

- GIVEN a match was settled and points written
- WHEN an admin corrects the result via manual override
- THEN applyMatchResult runs again, points are recomputed and overwritten for all affected predictions

### Requirement: Exhaustive Unit Test Coverage

The scoring function MUST be tested exhaustively across all achievable inputs and edge cases. The test suite MUST verify that totals 2, 5, and 6 are never returned.

#### Scenario: Impossible totals are never produced

- GIVEN the scoring function tested against a complete matrix of (0..5)x(0..5) predicted vs actual goals
- WHEN any combination is evaluated
- THEN the result is always a member of {0, 1, 3, 4, 7}

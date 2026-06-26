# Testability Specification

## Purpose

Testability is a first-class architectural requirement. The system design MUST make every domain rule testable without requiring live Cloudflare infrastructure, live Turso, or real Google OAuth.

## Requirements

### Requirement: Injectable Clock Port

The domain MUST NEVER call Date.now() or new Date() directly. A Clock port MUST be injected wherever time-dependent logic is evaluated (prediction lock, alarm scheduling, match status checks). Tests MUST be able to control the clock by injecting a fixed or advancing fake.

#### Scenario: Lock rule tested with injected clock

- GIVEN the prediction lock rule takes a Clock as a dependency
- WHEN a test injects a fake clock set to kickoff − 4min
- THEN the lock rule returns "locked"
- AND no real time elapses during the test

#### Scenario: Lock rule tested in unlocked state

- GIVEN a fake clock set to kickoff − 10min
- WHEN the lock rule is evaluated
- THEN the result is "unlocked"

### Requirement: Hexagonal Ports for External Dependencies

ResultSource, repositories (MatchRepository, PredictionRepository), and the scheduling adapter MUST be defined as interfaces (ports). Concrete implementations (Turso, Cloudflare DO, external API) are adapters. Tests MUST be able to swap in in-memory or stub implementations.

#### Scenario: Domain tested without Turso

- GIVEN an in-memory MatchRepository and PredictionRepository
- WHEN applyMatchResult is called in a unit test
- THEN the domain logic executes completely with no DB connection required

#### Scenario: ResultSource tested with a stub

- GIVEN a stub ResultSource that returns a fixed result
- WHEN the ingestion flow is invoked
- THEN the domain processes the result correctly without an HTTP call

### Requirement: Scoring Function Is Fully Exhaustively Tested

The pure scoring function MUST be tested against a complete enumeration of representative inputs covering all achievable outcomes {0, 1, 3, 4, 7} and all impossible outcomes {2, 5, 6}.

#### Scenario: Exhaustive scoring matrix verified

- GIVEN the scoring function
- WHEN tested against the full matrix of predicted vs actual goal combinations (at minimum 0–5 goals per team)
- THEN every result is a member of {0, 1, 3, 4, 7}
- AND tests explicitly assert that 2, 5, and 6 are never returned

### Requirement: Cloudflare Runtime Tests for DO and Alarms

Durable Object behavior (single-flight, alarm scheduling, alarm fire) MUST be tested inside the real Workers runtime using @cloudflare/vitest-pool-workers. Mock DO implementations are NOT acceptable for single-flight guarantees.

#### Scenario: Single-flight DO tested in workerd runtime

- GIVEN a test running in @cloudflare/vitest-pool-workers
- WHEN concurrent applyMatchResult calls are sent to the same DO instance
- THEN the test verifies that only one external call and one DB write occur

### Requirement: Seedable Local DB and Test Auth Bypass

Integration tests MUST be able to seed a local libSQL database with fixtures. E2E tests MUST have a test authentication bypass that does not require real Google OAuth credentials.

#### Scenario: Integration test uses in-memory libSQL

- GIVEN Vitest integration tests
- WHEN they run
- THEN they create an in-memory libSQL instance, run migrations, and seed fixtures
- AND no Turso network connection is required

#### Scenario: E2E test bypasses Google OAuth

- GIVEN a Playwright test
- WHEN it needs an authenticated session
- THEN it uses a test-mode auth bypass (e.g. a dedicated test login route active only in test environment) to establish a session without Google OAuth

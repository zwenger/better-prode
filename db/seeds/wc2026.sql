-- Seed fixture: wc2026.sql
-- World Cup 2026 MVP seed data for integration tests and E2E baseline.
--
-- Contents:
--   1 tournament (wc-2026)
--   8 teams (ARG, BRA, FRA, ESP, GER, ENG, POR, ITA)
--   3 matches (scheduled / in_progress / finished)
--   2 users
--   2 group memberships (one group)
--   Predictions for the finished match (with points)
--
-- Usage (local Turso dev):
--   turso db shell <db-name> < db/seeds/wc2026.sql
--
-- Usage (scripts/db-seed.js):
--   npm run db:seed
--
-- Idempotent: uses INSERT OR IGNORE so re-running does not fail.

-- ---------------------------------------------------------------------------
-- Tournament
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO tournament (id, name, created_at) VALUES
  ('wc-2026', 'FIFA World Cup 2026', '2026-01-01T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO team (id, tournament_id, name, code) VALUES
  ('team-arg', 'wc-2026', 'Argentina',  'AR'),
  ('team-bra', 'wc-2026', 'Brazil',     'BR'),
  ('team-fra', 'wc-2026', 'France',     'FR'),
  ('team-esp', 'wc-2026', 'Spain',      'ES'),
  ('team-ger', 'wc-2026', 'Germany',    'DE'),
  ('team-eng', 'wc-2026', 'England',    'GB-ENG'),
  ('team-por', 'wc-2026', 'Portugal',   'PT'),
  ('team-ita', 'wc-2026', 'Italy',      'IT');

-- ---------------------------------------------------------------------------
-- Matches
--   match-arg-bra: scheduled (future kickoff — open for predictions)
--   match-fra-esp: in_progress (live — prediction lock active, no score yet)
--   match-ger-eng: finished + settled (points computed)
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO match (
  id, tournament_id, home_team_id, away_team_id,
  kickoff_utc, status, home_score, away_score,
  result_source, settled_at, group_label, created_at
) VALUES
  (
    'match-arg-bra', 'wc-2026', 'team-arg', 'team-bra',
    '2026-07-15T20:00:00.000Z', 'scheduled', NULL, NULL,
    NULL, NULL, 'Group A',
    '2026-01-01T00:00:00.000Z'
  ),
  (
    'match-fra-esp', 'wc-2026', 'team-fra', 'team-esp',
    '2026-07-14T18:00:00.000Z', 'in_progress', NULL, NULL,
    NULL, NULL, 'Group B',
    '2026-01-01T00:00:00.000Z'
  ),
  (
    'match-ger-eng', 'wc-2026', 'team-ger', 'team-eng',
    '2026-07-10T16:00:00.000Z', 'finished', 2, 1,
    'auto', '2026-07-10T18:30:00.000Z', 'Group C',
    '2026-01-01T00:00:00.000Z'
  );

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO "user" (
  id, name, email, emailVerified, image, createdAt, updatedAt
) VALUES
  (
    'seed-user-1', 'Seed User One', 'seed1@example.com',
    1, NULL,
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
  ),
  (
    'seed-user-2', 'Seed User Two', 'seed2@example.com',
    1, NULL,
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
  );

-- ---------------------------------------------------------------------------
-- Group + memberships
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO "group" (id, name, owner_id, created_at) VALUES
  ('group-seed-1', 'Seed Group', 'seed-user-1', '2026-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO group_membership (group_id, user_id, role, joined_at) VALUES
  ('group-seed-1', 'seed-user-1', 'owner',  '2026-01-01T00:00:00.000Z'),
  ('group-seed-1', 'seed-user-2', 'member', '2026-01-01T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Predictions for the finished match (match-ger-eng, result 2-1)
--
-- Scoring rules (from src/domain/scoring.ts):
--   Correct result + exact score = 7 pts
--   Correct result + wrong score = 3 pts
--   Exact home OR away goal = +1 pt bonus per side
--
-- seed-user-1: predicted 2-1 (exact match) → 7 pts
-- seed-user-2: predicted 2-0 (correct result, wrong score, home exact) → 4 pts
--   (3 result pts + 1 home goal exact bonus)
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO prediction (
  id, user_id, match_id, home_goals, away_goals, points, created_at, updated_at
) VALUES
  (
    'pred-seed-1', 'seed-user-1', 'match-ger-eng',
    2, 1, 7,
    '2026-07-10T10:00:00.000Z', '2026-07-10T10:00:00.000Z'
  ),
  (
    'pred-seed-2', 'seed-user-2', 'match-ger-eng',
    2, 0, 4,
    '2026-07-10T10:00:00.000Z', '2026-07-10T10:00:00.000Z'
  );

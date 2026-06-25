-- E2E fixture seed — tracer-bullet vertical slice
-- Creates: 1 tournament, 2 teams, 1 match (future kickoff), 1 group, test users
-- Used by: tests/e2e/ via the dev server's local.db

-- Clear existing data (idempotent seed)
DELETE FROM group_membership;
DELETE FROM prediction;
DELETE FROM invitation;
DELETE FROM "group";
DELETE FROM match;
DELETE FROM team;
DELETE FROM tournament;
DELETE FROM "user";

-- Tournament
INSERT INTO tournament(id, name, created_at)
VALUES ('wc-2026', 'FIFA World Cup 2026', '2026-06-01T00:00:00.000Z');

-- Teams
INSERT INTO team(id, tournament_id, name, code)
VALUES ('team-argentina', 'wc-2026', 'Argentina', 'ARG');

INSERT INTO team(id, tournament_id, name, code)
VALUES ('team-brazil', 'wc-2026', 'Brazil', 'BRA');

-- Match — kickoff far in the future so it's NOT locked during E2E tests
INSERT INTO match(id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, created_at)
VALUES (
  'match-arg-bra',
  'wc-2026',
  'team-argentina',
  'team-brazil',
  '2026-07-15T20:00:00.000Z',
  'scheduled',
  '2026-06-01T00:00:00.000Z'
);

-- Test user (used by auth-bypass helper)
INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt)
VALUES (
  'test-user-e2e-seed',
  'E2E Test User',
  'test@better-prode.test',
  0,
  NULL,
  '2026-06-01T00:00:00.000Z',
  '2026-06-01T00:00:00.000Z'
);

-- Admin user (for apply-result E2E)
INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt)
VALUES (
  'test-admin-e2e-seed',
  'E2E Admin User',
  'admin@better-prode.test',
  0,
  NULL,
  '2026-06-01T00:00:00.000Z',
  '2026-06-01T00:00:00.000Z'
);

-- Group owned by test user
INSERT INTO "group"(id, name, owner_id, created_at)
VALUES (
  'group-e2e-test',
  'E2E Test Group',
  'test-user-e2e-seed',
  '2026-06-01T00:00:00.000Z'
);

-- Group membership
INSERT INTO group_membership(group_id, user_id, role, joined_at)
VALUES ('group-e2e-test', 'test-user-e2e-seed', 'owner', '2026-06-01T00:00:00.000Z');

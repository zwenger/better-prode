-- Migration: 0001_init
-- World Cup Prode — initial schema
-- Timestamps: ISO 8601 UTC TEXT (SQLite has no datetime type)

CREATE TABLE tournament (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE team (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournament(id),
  name TEXT NOT NULL,
  code TEXT
);

CREATE TABLE match (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournament(id),
  home_team_id TEXT NOT NULL REFERENCES team(id),
  away_team_id TEXT NOT NULL REFERENCES team(id),
  kickoff_utc TEXT NOT NULL, -- ISO 8601 UTC
  status TEXT NOT NULL CHECK(status IN ('scheduled', 'in_progress', 'finished')),
  home_score INTEGER, -- null until known
  away_score INTEGER, -- null until known
  result_source TEXT CHECK(result_source IN ('auto', 'manual')),
  settled_at TEXT, -- set when points have been computed
  created_at TEXT NOT NULL
);

CREATE INDEX idx_match_kickoff ON match(kickoff_utc);
CREATE INDEX idx_match_status ON match(status);

-- Better Auth canonical user table — camelCase columns match the Kysely SQLite adapter.
-- Required columns per Better Auth docs: id, name (NOT NULL), email (UNIQUE NOT NULL),
-- emailVerified (boolean as INTEGER), image, createdAt, updatedAt.
CREATE TABLE "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE prediction (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  match_id TEXT NOT NULL REFERENCES match(id),
  home_goals INTEGER NOT NULL,
  away_goals INTEGER NOT NULL,
  points INTEGER, -- null until settlement
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, match_id)
);

CREATE INDEX idx_prediction_match ON prediction(match_id);
-- Leaderboard hot path: SUM(points) per user scoped to a group's members
CREATE INDEX idx_prediction_user_points ON prediction(user_id, points);

CREATE TABLE "group" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT NOT NULL
);

CREATE TABLE group_membership (
  group_id TEXT NOT NULL REFERENCES "group"(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_membership_user ON group_membership(user_id);

CREATE TABLE invitation (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES "group"(id),
  token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected', 'revoked')),
  created_at TEXT NOT NULL,
  expires_at TEXT
);

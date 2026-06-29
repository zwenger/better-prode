-- Migration: 0005_tbd_match_columns
-- Make home_team_id and away_team_id nullable on the match table.
-- Add home_placeholder and away_placeholder TEXT columns.
--
-- SQLite has no ALTER COLUMN, so we rebuild the table.
-- FK-OFF wrap is MANDATORY because prediction.match_id REFERENCES match(id)
-- and the DROP + RENAME would trip FK enforcement.
--
-- Column order after 0001 + 0003:
-- id, tournament_id, home_team_id, away_team_id, kickoff_utc, status,
-- home_score, away_score, result_source, settled_at, created_at,
-- group_label, stage_id

PRAGMA foreign_keys=OFF;
BEGIN;

CREATE TABLE match_new (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournament(id),
  home_team_id TEXT REFERENCES team(id),
  away_team_id TEXT REFERENCES team(id),
  kickoff_utc TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('scheduled', 'in_progress', 'finished')),
  home_score INTEGER,
  away_score INTEGER,
  result_source TEXT CHECK(result_source IN ('auto', 'manual')),
  settled_at TEXT,
  created_at TEXT NOT NULL,
  group_label TEXT,
  stage_id TEXT,
  home_placeholder TEXT,
  away_placeholder TEXT
);

INSERT INTO match_new (id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, home_score, away_score, result_source, settled_at, created_at, group_label, stage_id, home_placeholder, away_placeholder)
SELECT id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, home_score, away_score, result_source, settled_at, created_at, group_label, stage_id, NULL, NULL FROM match;

DROP TABLE match;

ALTER TABLE match_new RENAME TO match;

CREATE INDEX idx_match_kickoff ON match(kickoff_utc);
CREATE INDEX idx_match_status ON match(status);

COMMIT;
PRAGMA foreign_keys=ON;

-- Migration: 0006_penalty_shootout
-- Add penalty shootout result columns to the match table.
-- These are display-only fields — they NEVER feed into scoring.
-- Additive nullable columns: no table rebuild required for SQLite ADD COLUMN.

ALTER TABLE match ADD COLUMN home_penalty_score INTEGER;
ALTER TABLE match ADD COLUMN away_penalty_score INTEGER;
ALTER TABLE match ADD COLUMN winner_team_id TEXT;

-- Demo seed — minimal data to validate the deployed pipeline (one tournament,
-- two teams, one upcoming match). Not the real World Cup dataset (that's PR 6).
-- Idempotent via INSERT OR IGNORE so it can be re-applied safely.

INSERT OR IGNORE INTO tournament (id, name, created_at)
VALUES ('t-demo', 'World Cup 2026 (demo)', '2026-06-25T00:00:00Z');

INSERT OR IGNORE INTO team (id, tournament_id, name, code) VALUES
  ('tm-arg', 't-demo', 'Argentina', 'ARG'),
  ('tm-fra', 't-demo', 'France', 'FRA');

INSERT OR IGNORE INTO match
  (id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, home_score, away_score, result_source, settled_at, created_at)
VALUES
  ('m-demo-1', 't-demo', 'tm-arg', 'tm-fra', '2026-07-01T18:00:00Z', 'scheduled', NULL, NULL, NULL, NULL, '2026-06-25T00:00:00Z');

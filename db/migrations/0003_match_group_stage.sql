-- Migration: 0003_match_group_stage
-- Additive: add group_label and stage_id to the match table.
-- Both columns are nullable — backward-compatible with existing rows.
-- group_label: human-readable group name (e.g. "Group A")
-- stage_id:    provider-specific stage identifier (e.g. "289273")

ALTER TABLE match ADD COLUMN group_label TEXT;
ALTER TABLE match ADD COLUMN stage_id TEXT;

-- Migration: 0004_push_subscriptions
-- Adds the push_subscription table for Web Push reminder delivery.
-- One subscription per user (UNIQUE on user_id) — last subscription wins.
-- p256dh and auth are the browser-provided encryption keys for the VAPID push envelope.
-- Timestamps: ISO 8601 UTC TEXT (consistent with rest of schema).

CREATE TABLE push_subscription (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id)
);

CREATE INDEX idx_push_subscription_user ON push_subscription(user_id);

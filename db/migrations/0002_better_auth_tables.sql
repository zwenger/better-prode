-- Migration: 0002_better_auth_tables
-- Better Auth session, account, and verification tables.
-- Column names use camelCase to match Better Auth's Kysely SQLite adapter
-- fieldName convention (Better Auth stores camelCase column names in SQLite).
-- Timestamps are stored as TEXT (ISO 8601 UTC) matching SQLite conventions.

-- session — stores active user sessions minted by Better Auth
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  expiresAt TEXT NOT NULL,   -- ISO 8601 UTC
  token TEXT UNIQUE NOT NULL,
  createdAt TEXT NOT NULL,   -- ISO 8601 UTC
  updatedAt TEXT NOT NULL,   -- ISO 8601 UTC
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_userId ON session(userId);
CREATE INDEX idx_session_token ON session(token);

-- account — links OAuth provider accounts to users
CREATE TABLE account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,   -- ISO 8601 UTC
  refreshTokenExpiresAt TEXT,  -- ISO 8601 UTC
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL,     -- ISO 8601 UTC
  updatedAt TEXT NOT NULL      -- ISO 8601 UTC
);

CREATE INDEX idx_account_userId ON account(userId);

-- verification — email/OTP verification tokens
CREATE TABLE verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,  -- ISO 8601 UTC
  createdAt TEXT NOT NULL,  -- ISO 8601 UTC
  updatedAt TEXT NOT NULL   -- ISO 8601 UTC
);

CREATE INDEX idx_verification_identifier ON verification(identifier);

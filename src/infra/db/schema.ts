/**
 * Drizzle ORM schema — mirrors the production schema exactly.
 *
 * Sources of truth: db/migrations/0001_init.sql (domain tables, snake_case)
 *                   db/migrations/0002_better_auth_tables.sql (auth tables, camelCase)
 *
 * IMPORTANT: Column names must not be renamed — the live Turso DB already has
 * this schema. Any rename here would break queries against production.
 */

import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Domain tables (snake_case columns — 0001_init.sql)
// ---------------------------------------------------------------------------

export const tournament = sqliteTable("tournament", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const team = sqliteTable("team", {
  id: text("id").primaryKey(),
  tournamentId: text("tournament_id")
    .notNull()
    .references(() => tournament.id),
  name: text("name").notNull(),
  code: text("code"),
});

export const match = sqliteTable(
  "match",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournament.id),
    homeTeamId: text("home_team_id")
      .notNull()
      .references(() => team.id),
    awayTeamId: text("away_team_id")
      .notNull()
      .references(() => team.id),
    kickoffUtc: text("kickoff_utc").notNull(),
    status: text("status", { enum: ["scheduled", "in_progress", "finished"] }).notNull(),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    resultSource: text("result_source", { enum: ["auto", "manual"] }),
    settledAt: text("settled_at"),
    groupLabel: text("group_label"),
    stageId: text("stage_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_match_kickoff").on(t.kickoffUtc),
    index("idx_match_status").on(t.status),
  ]
);

// Better Auth canonical user table (camelCase columns to match Better Auth convention).
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

export const prediction = sqliteTable(
  "prediction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    matchId: text("match_id")
      .notNull()
      .references(() => match.id),
    homeGoals: integer("home_goals").notNull(),
    awayGoals: integer("away_goals").notNull(),
    points: integer("points"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("prediction_user_id_match_id_unique").on(t.userId, t.matchId),
    index("idx_prediction_match").on(t.matchId),
    index("idx_prediction_user_points").on(t.userId, t.points),
  ]
);

export const group = sqliteTable("group", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  createdAt: text("created_at").notNull(),
});

export const groupMembership = sqliteTable(
  "group_membership",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => group.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
    joinedAt: text("joined_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("idx_membership_user").on(t.userId),
  ]
);

export const invitation = sqliteTable("invitation", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => group.id),
  token: text("token").notNull().unique(),
  status: text("status", { enum: ["pending", "accepted", "rejected", "revoked"] }).notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
});

// ---------------------------------------------------------------------------
// Better Auth tables (camelCase columns — 0002_better_auth_tables.sql)
// ---------------------------------------------------------------------------

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: text("expiresAt").notNull(),
    token: text("token").notNull().unique(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("idx_session_userId").on(t.userId),
    index("idx_session_token").on(t.token),
  ]
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: text("accessTokenExpiresAt"),
    refreshTokenExpiresAt: text("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (t) => [index("idx_account_userId").on(t.userId)]
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: text("expiresAt").notNull(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (t) => [index("idx_verification_identifier").on(t.identifier)]
);

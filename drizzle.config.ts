import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for schema management.
 *
 * db:generate  → generate migration SQL from schema changes
 * db:migrate   → apply pending migrations to the target DB
 *
 * Uses Turso (libSQL) as the dialect since this project runs on Turso in
 * production and uses turso dev locally for E2E testing.
 */
export default defineConfig({
  dialect: "turso",
  schema: "./src/infra/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env["TURSO_DATABASE_URL"] ?? "file:./local.db",
    authToken: process.env["TURSO_AUTH_TOKEN"],
  },
});

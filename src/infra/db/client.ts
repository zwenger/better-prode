import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type AppSchema = typeof schema;
export type DrizzleDb = LibSQLDatabase<AppSchema>;

/**
 * Creates a libSQL/Turso client from environment variables.
 *
 * Production: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 * Local dev:  TURSO_DATABASE_URL=file:./local.db (token optional)
 * Tests:      TURSO_DATABASE_URL=:memory: (no token needed)
 */
export function createDbClient(): Client {
  const url = process.env["TURSO_DATABASE_URL"];

  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is required. " +
        "Set it to 'libsql://...turso.io' for production, " +
        "'file:./local.db' for local dev, or ':memory:' for tests."
    );
  }

  const authToken = process.env["TURSO_AUTH_TOKEN"];

  return createClient({
    url,
    authToken,
  });
}

/**
 * Creates a Drizzle ORM instance wrapping a libSQL client.
 * The schema is embedded so Drizzle can generate typed queries.
 */
export function createDrizzleDb(client: Client): DrizzleDb {
  return drizzle(client, { schema });
}

/**
 * Singleton client for server-side use.
 * Import this in server loaders and actions.
 */
let _client: Client | null = null;
let _db: DrizzleDb | null = null;

export function getDbClient(): Client {
  if (!_client) {
    _client = createDbClient();
  }
  return _client;
}

export function getDb(): DrizzleDb {
  if (!_db) {
    _db = createDrizzleDb(getDbClient());
  }
  return _db;
}

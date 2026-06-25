/**
 * DB test helpers — creates an in-memory libSQL DB wrapped in a Drizzle instance,
 * runs migrations, and returns it for use in adapter integration tests.
 *
 * Uses :memory: URL so no file system is needed and each test gets
 * a clean slate.
 */

import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzleDb } from "#/infra/db/client";
import type { DrizzleDb } from "#/infra/db/client";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Runs a SQL migration file against the given libSQL client.
 * Strips single-line comments then splits on semicolons.
 */
async function runMigrationFile(client: Client, filePath: string): Promise<void> {
  const sql = readFileSync(filePath, "utf8");

  const withoutComments = sql
    .split("\n")
    .map((line) => {
      const commentIdx = line.indexOf("--");
      return commentIdx >= 0 ? line.slice(0, commentIdx) : line;
    })
    .join("\n");

  const statements = withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await client.execute(stmt);
  }
}

/**
 * Creates an in-memory libSQL client with the full schema applied,
 * wrapped in a Drizzle ORM instance.
 * Call this in beforeEach to get a clean DB for each test.
 */
export async function createTestDb(): Promise<DrizzleDb & { $client: Client }> {
  const client = createClient({ url: ":memory:" });

  const migrationsDir = join(__dirname, "../../../db/migrations");
  await runMigrationFile(client, join(migrationsDir, "0001_init.sql"));
  await runMigrationFile(client, join(migrationsDir, "0002_better_auth_tables.sql"));
  await runMigrationFile(client, join(migrationsDir, "0003_match_group_stage.sql"));

  const db = createDrizzleDb(client);
  // Expose the underlying client for test fixtures that use raw SQL inserts.
  return Object.assign(db, { $client: client });
}

/** Generate a test ID (deterministic for readability). */
export function testId(label: string): string {
  return `test-${label}-${Date.now()}`;
}

/**
 * DB test helpers — creates an in-memory libSQL DB and runs migrations.
 * Used by all adapter integration tests.
 *
 * Uses :memory: URL so no file system is needed and each test gets
 * a clean slate.
 */

import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Creates an in-memory libSQL client and applies the initial migration.
 * Call this in beforeEach to get a clean DB for each test.
 */
export async function createTestDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });

  const migrationPath = join(
    __dirname,
    "../../../db/migrations/0001_init.sql"
  );
  const sql = readFileSync(migrationPath, "utf8");

  // SQLite in-memory doesn't support multi-statement execute in a single call.
  // Remove single-line comments then split on semicolons.
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
    await db.execute(stmt);
  }

  return db;
}

/** Generate a test ID (deterministic for readability). */
export function testId(label: string): string {
  return `test-${label}-${Date.now()}`;
}

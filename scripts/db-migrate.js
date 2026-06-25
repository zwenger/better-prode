#!/usr/bin/env node
/**
 * Runs all pending SQL migrations from db/migrations/ in order.
 * Idempotent: skips already-applied files using a schema_migrations tracking table.
 *
 * Usage: npm run db:migrate
 *
 * Requires TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for production Turso).
 * For local dev, set TURSO_DATABASE_URL=file:./local.db
 *
 * Note on statement splitting: the naive `;` split works for the current
 * migration files (no semicolons inside strings or comments). Avoid adding
 * semicolons inside SQL string literals in migration files.
 */
import { createClient } from "@libsql/client";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "../db/migrations");

async function main() {
  const url = process.env["TURSO_DATABASE_URL"];
  if (!url) {
    console.error("Error: TURSO_DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = createClient({
    url,
    authToken: process.env["TURSO_AUTH_TOKEN"],
  });

  // Ensure the tracking table exists before checking applied migrations.
  await client.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
  );

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Checking ${files.length} migration file(s)...`);

  for (const file of files) {
    // Check if this migration has already been applied.
    const check = await client.execute({
      sql: `SELECT filename FROM schema_migrations WHERE filename = ?`,
      args: [file],
    });

    if (check.rows.length > 0) {
      console.log(`  ✓ ${file} (already applied — skipping)`);
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = await fs.readFile(filePath, "utf-8");

    console.log(`  → ${file}`);
    // Split on semicolons for multi-statement files.
    // Strip single-line comments first to avoid splitting on semicolons in comments.
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
      .filter(Boolean);

    for (const statement of statements) {
      await client.execute(statement);
    }

    // Record the migration as applied.
    await client.execute({
      sql: `INSERT INTO schema_migrations(filename, applied_at) VALUES (?, ?)`,
      args: [file, new Date().toISOString()],
    });
  }

  console.log("Migrations complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Runs all pending SQL migrations from db/migrations/ in order.
 *
 * Usage: npm run db:migrate
 *
 * Requires TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for production Turso).
 * For local dev, set TURSO_DATABASE_URL=file:./local.db
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

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Running ${files.length} migration(s)...`);

  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = await fs.readFile(filePath, "utf-8");

    console.log(`  → ${file}`);
    // Split on semicolons for multi-statement files
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await client.execute(statement);
    }
  }

  console.log("Migrations complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

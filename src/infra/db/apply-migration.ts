/**
 * Shared migration-file applier.
 *
 * This is the single source of truth for HOW a hand-written `db/migrations/*.sql`
 * file is applied to a libSQL database. Both the test harness
 * (`src/adapters/db/test-helpers.ts`) and the production migration runner
 * (`scripts/db-migrate.ts`) call through here, which guarantees TESTS and PROD
 * apply identical SQL.
 *
 * Behaviour:
 *  - Delegates the whole script to `client.executeMultiple(sql)`.
 *  - `executeMultiple` runs the entire script as ONE session on a SINGLE
 *    stream (HTTP transport pipelines via `stream.sequence`), so connection
 *    state set by `PRAGMA` lines and transaction control (`BEGIN`/`COMMIT`)
 *    PERSISTS across the statements in the file.
 *  - This matters for migration 0005, whose table rebuild must run with
 *    `PRAGMA foreign_keys=OFF` in effect for the DROP + RENAME. A previous
 *    per-statement `;`-splitter executed each statement on its OWN stream over
 *    HTTP (Turso), so the OFF pragma did not survive to the DROP and FK
 *    enforcement would have failed the rebuild against prod.
 */

import { readFileSync } from 'node:fs'
import type { Client } from '@libsql/client'

/**
 * Applies a SQL migration string against the given libSQL client.
 *
 * Runs the whole script via {@link Client.executeMultiple}, which executes it
 * as a single session on one stream so that PRAGMA and transaction state
 * persist across statements.
 */
export async function applyMigrationSql(
  client: Client,
  sql: string,
): Promise<void> {
  await client.executeMultiple(sql)
}

/**
 * Reads a SQL migration file from disk and applies it via {@link applyMigrationSql}.
 */
export async function applyMigrationFile(
  client: Client,
  filePath: string,
): Promise<void> {
  const sql = readFileSync(filePath, 'utf8')
  await applyMigrationSql(client, sql)
}

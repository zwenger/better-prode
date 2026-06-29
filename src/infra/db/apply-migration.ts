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
 *  - Strips single-line `--` comments.
 *  - Splits on `;` and executes each non-empty statement in order.
 *  - This naturally handles PRAGMA lines and multi-statement table rebuilds
 *    (e.g. migration 0005, which wraps a CREATE/INSERT/DROP/RENAME sequence in
 *    PRAGMA foreign_keys=OFF/ON).
 */

import { readFileSync } from 'node:fs'
import type { Client } from '@libsql/client'

/**
 * Applies a SQL migration string against the given libSQL client.
 * Strips single-line comments, then splits on semicolons and executes
 * each statement sequentially.
 */
export async function applyMigrationSql(
  client: Client,
  sql: string,
): Promise<void> {
  const withoutComments = sql
    .split('\n')
    .map((line) => {
      const commentIdx = line.indexOf('--')
      return commentIdx >= 0 ? line.slice(0, commentIdx) : line
    })
    .join('\n')

  const statements = withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    await client.execute(stmt)
  }
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

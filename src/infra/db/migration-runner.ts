/**
 * Migration runner core.
 *
 * The committed, repeatable migration path for better-prode. Tracks applied
 * migrations in `schema_migrations(filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
 * and applies hand-written `db/migrations/*.sql` files via the shared
 * {@link applyMigrationFile} so TESTS and PROD apply identical SQL.
 *
 * This module is environment-agnostic: it operates on a libSQL `Client` and a
 * migrations directory. The thin CLI wrapper lives at `scripts/db-migrate.ts`.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Client } from '@libsql/client'
import { applyMigrationFile } from '#/infra/db/apply-migration'

/** Result of applying pending migrations. */
export interface RunResult {
  /** Filenames that were applied during this run, in order. */
  applied: string[]
  /** Filenames already recorded and therefore skipped, in order. */
  skipped: string[]
}

/** Status snapshot of the migrations directory vs the schema_migrations table. */
export interface MigrationStatus {
  /** Filenames recorded as applied, in order. */
  applied: string[]
  /** Filenames present on disk but not yet recorded, in order. */
  pending: string[]
}

/**
 * Creates the schema_migrations tracking table if it does not exist.
 * Safe to call repeatedly.
 */
export async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
}

/** Lists `*.sql` migration files in the directory, sorted by filename ascending. */
function listMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
}

/** Returns the set of already-recorded migration filenames. */
async function getAppliedSet(client: Client): Promise<Set<string>> {
  const rows = await client.execute({
    sql: `SELECT filename FROM schema_migrations`,
    args: [],
  })
  return new Set(rows.rows.map((r) => String(r[0])))
}

/**
 * Applies all migrations on disk that are not yet recorded in schema_migrations,
 * in filename order. Each migration is recorded ONLY after it applies
 * successfully. If a migration fails, the error propagates and that migration
 * (and any after it) is left unrecorded.
 */
export async function runPendingMigrations(
  client: Client,
  migrationsDir: string,
): Promise<RunResult> {
  await ensureMigrationsTable(client)

  const files = listMigrationFiles(migrationsDir)
  const applied = await getAppliedSet(client)

  const result: RunResult = { applied: [], skipped: [] }

  for (const file of files) {
    if (applied.has(file)) {
      result.skipped.push(file)
      continue
    }

    await applyMigrationFile(client, join(migrationsDir, file))
    await client.execute({
      sql: `INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)`,
      args: [file, new Date().toISOString()],
    })
    result.applied.push(file)
  }

  return result
}

/**
 * Records a migration as applied WITHOUT executing its SQL. Intended for
 * one-time reconciliation of migrations that are already present in a database
 * but were never recorded (prod's manually-applied 0003/0004).
 *
 * Refuses to mark a filename that does not exist in the migrations directory.
 */
export async function markMigrationApplied(
  client: Client,
  migrationsDir: string,
  filename: string,
): Promise<void> {
  const files = listMigrationFiles(migrationsDir)
  if (!files.includes(filename)) {
    throw new Error(
      `Cannot mark "${filename}" as applied: file not found in ${migrationsDir}. ` +
        `Known migrations: ${files.join(', ') || '(none)'}`,
    )
  }

  await ensureMigrationsTable(client)
  await client.execute({
    sql: `INSERT OR IGNORE INTO schema_migrations (filename, applied_at) VALUES (?, ?)`,
    args: [filename, new Date().toISOString()],
  })
}

/**
 * Reports which migrations are applied vs pending WITHOUT applying anything.
 */
export async function getMigrationStatus(
  client: Client,
  migrationsDir: string,
): Promise<MigrationStatus> {
  await ensureMigrationsTable(client)

  const files = listMigrationFiles(migrationsDir)
  const appliedSet = await getAppliedSet(client)

  const applied: string[] = []
  const pending: string[] = []
  for (const file of files) {
    if (appliedSet.has(file)) {
      applied.push(file)
    } else {
      pending.push(file)
    }
  }

  return { applied, pending }
}

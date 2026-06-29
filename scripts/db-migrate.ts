#!/usr/bin/env tsx
/**
 * db-migrate — the committed, repeatable migration runner for better-prode.
 *
 * THIS is the migration path. Applied migrations are tracked in
 * `schema_migrations(filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`.
 * It applies hand-written `db/migrations/*.sql` files via the shared applier
 * (`src/infra/db/apply-migration.ts`), so TESTS and PROD apply identical SQL.
 *
 * Usage:
 *   npm run db:migrate                         apply all pending migrations
 *   npm run db:migrate -- --status             dry-run: print pending vs applied
 *   npm run db:migrate -- --mark-applied 0003_match_group_stage.sql
 *                                              record a migration WITHOUT
 *                                              executing it (one-time reconcile)
 *
 * Environment variables:
 *   TURSO_DATABASE_URL   — libSQL URL (libsql://...turso.io | file:./local.db | :memory:)
 *   TURSO_AUTH_TOKEN     — auth token for Turso (optional for file:/:memory:)
 *
 * This script is a Node CLI (tsx), NEVER imported by the Workers bundle, and is
 * the only sanctioned way to apply schema changes. drizzle-kit is retained only
 * for authoring/diffing SQL (`db:generate`); `drizzle-kit migrate` is NOT used.
 */

import { createClient } from '@libsql/client'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  runPendingMigrations,
  markMigrationApplied,
  getMigrationStatus,
} from '#/infra/db/migration-runner'

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../db/migrations',
)

interface ParsedArgs {
  mode: 'apply' | 'status' | 'mark-applied'
  filename?: string
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes('--status')) {
    return { mode: 'status' }
  }

  const markIdx = argv.indexOf('--mark-applied')
  if (markIdx >= 0) {
    const filename = argv[markIdx + 1]
    if (!filename || filename.startsWith('--')) {
      console.error('Error: --mark-applied requires a filename argument.')
      console.error(
        'Example: npm run db:migrate -- --mark-applied 0003_match_group_stage.sql',
      )
      process.exit(1)
    }
    return { mode: 'mark-applied', filename }
  }

  return { mode: 'apply' }
}

async function main(): Promise<void> {
  const { mode, filename } = parseArgs(process.argv.slice(2))

  const tursoUrl = process.env['TURSO_DATABASE_URL']
  const tursoToken = process.env['TURSO_AUTH_TOKEN']

  if (!tursoUrl) {
    console.error('Error: TURSO_DATABASE_URL environment variable is required.')
    console.error(
      "Set it to 'libsql://...turso.io' for production, " +
        "'file:./local.db' for local dev, or ':memory:' for tests.",
    )
    process.exit(1)
  }

  const client = createClient({ url: tursoUrl, authToken: tursoToken })

  if (mode === 'status') {
    const status = await getMigrationStatus(client, MIGRATIONS_DIR)
    console.log('[db-migrate] Status (dry-run — nothing applied):')
    console.log(`  Applied (${status.applied.length}):`)
    for (const f of status.applied) console.log(`    ✓ ${f}`)
    console.log(`  Pending (${status.pending.length}):`)
    for (const f of status.pending) console.log(`    • ${f}`)
    process.exit(0)
  }

  if (mode === 'mark-applied') {
    await markMigrationApplied(client, MIGRATIONS_DIR, filename!)
    console.log(
      `[db-migrate] Marked "${filename}" as applied WITHOUT executing it (reconciliation).`,
    )
    process.exit(0)
  }

  // mode === "apply"
  console.log('[db-migrate] Applying pending migrations...')
  const result = await runPendingMigrations(client, MIGRATIONS_DIR)

  if (result.skipped.length > 0) {
    console.log(
      `[db-migrate] Skipped ${result.skipped.length} already-applied migration(s):`,
    )
    for (const f of result.skipped) console.log(`    - ${f}`)
  }
  if (result.applied.length > 0) {
    console.log(`[db-migrate] Applied ${result.applied.length} migration(s):`)
    for (const f of result.applied) console.log(`    ✓ ${f}`)
  } else {
    console.log('[db-migrate] No pending migrations. Database is up to date.')
  }

  process.exit(0)
}

main().catch((err: unknown) => {
  console.error(
    '[db-migrate] Fatal:',
    err instanceof Error ? err.message : String(err),
  )
  process.exit(1)
})

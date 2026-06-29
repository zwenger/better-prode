/**
 * TDD (RED): Migration runner core (the logic behind scripts/db-migrate.ts).
 *
 * The runner must:
 *  - ensure schema_migrations(filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)
 *  - apply pending db/migrations/*.sql in filename order, recording only on success
 *  - be idempotent: a second run applies nothing
 *  - support --mark-applied: record a migration WITHOUT executing it; reject unknown files
 *  - support a status/dry-run that reports pending vs applied without applying
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '@libsql/client'
import type { Client } from '@libsql/client'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureMigrationsTable,
  runPendingMigrations,
  markMigrationApplied,
  getMigrationStatus,
} from '#/infra/db/migration-runner'

let client: Client
let dir: string

function writeMigration(name: string, sql: string): void {
  writeFileSync(join(dir, name), sql, 'utf8')
}

beforeEach(() => {
  client = createClient({ url: ':memory:' })
  dir = mkdtempSync(join(tmpdir(), 'bp-migrations-'))
})

describe('ensureMigrationsTable', () => {
  it('creates schema_migrations with the expected shape', async () => {
    await ensureMigrationsTable(client)
    const cols = await client.execute({
      sql: `PRAGMA table_info(schema_migrations)`,
      args: [],
    })
    const names = cols.rows.map((r) => r[1])
    expect(names).toEqual(['filename', 'applied_at'])
  })

  it('is safe to call twice', async () => {
    await ensureMigrationsTable(client)
    await expect(ensureMigrationsTable(client)).resolves.not.toThrow()
  })
})

describe('runPendingMigrations', () => {
  it('applies all pending migrations in filename order and records them', async () => {
    writeMigration('0001_a.sql', `CREATE TABLE a (id TEXT PRIMARY KEY);`)
    writeMigration('0002_b.sql', `CREATE TABLE b (id TEXT PRIMARY KEY);`)

    const result = await runPendingMigrations(client, dir)
    expect(result.applied).toEqual(['0001_a.sql', '0002_b.sql'])
    expect(result.skipped).toEqual([])

    const recorded = await client.execute({
      sql: `SELECT filename FROM schema_migrations ORDER BY filename`,
      args: [],
    })
    expect(recorded.rows.map((r) => r[0])).toEqual(['0001_a.sql', '0002_b.sql'])

    // Tables were actually created
    const tables = await client.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a','b') ORDER BY name`,
      args: [],
    })
    expect(tables.rows.map((r) => r[0])).toEqual(['a', 'b'])
  })

  it('is idempotent: a second run applies nothing', async () => {
    writeMigration('0001_a.sql', `CREATE TABLE a (id TEXT PRIMARY KEY);`)

    await runPendingMigrations(client, dir)
    const second = await runPendingMigrations(client, dir)

    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(['0001_a.sql'])
  })

  it('does NOT record a migration whose SQL fails', async () => {
    writeMigration('0001_ok.sql', `CREATE TABLE ok (id TEXT PRIMARY KEY);`)
    writeMigration('0002_bad.sql', `THIS IS NOT VALID SQL;`)

    await expect(runPendingMigrations(client, dir)).rejects.toThrow()

    const recorded = await client.execute({
      sql: `SELECT filename FROM schema_migrations ORDER BY filename`,
      args: [],
    })
    // 0001 recorded, 0002 must NOT be recorded since it failed.
    expect(recorded.rows.map((r) => r[0])).toEqual(['0001_ok.sql'])
  })
})

describe('markMigrationApplied', () => {
  it('records a migration WITHOUT executing its SQL', async () => {
    // SQL that would fail if executed (table does not exist).
    writeMigration('0001_destructive.sql', `DROP TABLE nonexistent_table;`)

    await markMigrationApplied(client, dir, '0001_destructive.sql')

    const recorded = await client.execute({
      sql: `SELECT filename FROM schema_migrations WHERE filename = '0001_destructive.sql'`,
      args: [],
    })
    expect(recorded.rows.length).toBe(1)

    // A subsequent run treats it as already applied (skipped, not executed).
    const result = await runPendingMigrations(client, dir)
    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual(['0001_destructive.sql'])
  })

  it('rejects a filename that is not present in the migrations dir', async () => {
    await expect(
      markMigrationApplied(client, dir, '9999_does_not_exist.sql'),
    ).rejects.toThrow()
  })

  it('is idempotent: marking twice leaves exactly one row with unchanged applied_at', async () => {
    writeMigration('0001_a.sql', `CREATE TABLE a (id TEXT PRIMARY KEY);`)

    await markMigrationApplied(client, dir, '0001_a.sql')
    const first = await client.execute({
      sql: `SELECT applied_at FROM schema_migrations WHERE filename = '0001_a.sql'`,
      args: [],
    })
    const firstAppliedAt = first.rows[0]?.[0]

    await markMigrationApplied(client, dir, '0001_a.sql')
    const after = await client.execute({
      sql: `SELECT applied_at FROM schema_migrations WHERE filename = '0001_a.sql'`,
      args: [],
    })

    // Exactly one row, and the original applied_at is preserved (INSERT OR IGNORE).
    expect(after.rows.length).toBe(1)
    expect(after.rows[0]?.[0]).toBe(firstAppliedAt)
  })
})

describe('getMigrationStatus', () => {
  it('reports pending vs applied without applying anything', async () => {
    writeMigration('0001_a.sql', `CREATE TABLE a (id TEXT PRIMARY KEY);`)
    writeMigration('0002_b.sql', `CREATE TABLE b (id TEXT PRIMARY KEY);`)

    await markMigrationApplied(client, dir, '0001_a.sql')

    const status = await getMigrationStatus(client, dir)
    expect(status.applied).toEqual(['0001_a.sql'])
    expect(status.pending).toEqual(['0002_b.sql'])

    // Status must NOT have executed the pending migration.
    const tables = await client.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = 'b'`,
      args: [],
    })
    expect(tables.rows.length).toBe(0)
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

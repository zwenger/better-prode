/**
 * TDD (RED): Shared migration-file applier.
 *
 * `applyMigrationSql` / `applyMigrationFile` must correctly apply a
 * multi-statement migration, including PRAGMA lines and comment stripping,
 * exactly the way the test helpers historically applied migration 0005
 * (a table rebuild wrapped in PRAGMA foreign_keys=OFF/ON).
 */

import { describe, it, expect } from 'vitest'
import { createClient } from '@libsql/client'
import {
  applyMigrationSql,
  applyMigrationFile,
} from '#/infra/db/apply-migration'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../db/migrations',
)

describe('applyMigrationSql', () => {
  it('applies a multi-statement migration with PRAGMA lines and comments', async () => {
    const client = createClient({ url: ':memory:' })

    const sql = `
      -- a comment that must be stripped
      PRAGMA foreign_keys=OFF;

      CREATE TABLE parent (id TEXT PRIMARY KEY);
      CREATE TABLE child (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES parent(id) -- inline comment
      );

      PRAGMA foreign_keys=ON;
    `

    await expect(applyMigrationSql(client, sql)).resolves.not.toThrow()

    // Both tables exist
    const tables = await client.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('parent','child') ORDER BY name`,
      args: [],
    })
    expect(tables.rows.map((r) => r[0])).toEqual(['child', 'parent'])
  })

  it('ignores empty statements and trailing semicolons', async () => {
    const client = createClient({ url: ':memory:' })
    await expect(
      applyMigrationSql(client, `CREATE TABLE t (id TEXT);;;\n\n`),
    ).resolves.not.toThrow()
  })
})

describe('applyMigrationFile', () => {
  it('applies the real 0005 table-rebuild migration on top of 0001+0003', async () => {
    const client = createClient({ url: ':memory:' })

    await applyMigrationFile(client, join(migrationsDir, '0001_init.sql'))
    await applyMigrationFile(
      client,
      join(migrationsDir, '0003_match_group_stage.sql'),
    )
    await applyMigrationFile(
      client,
      join(migrationsDir, '0005_tbd_match_columns.sql'),
    )

    // After 0005, placeholder columns exist and team FKs are nullable.
    await client.execute({
      sql: `INSERT INTO tournament (id, name, created_at) VALUES ('t1','T','2026-01-01')`,
      args: [],
    })
    await expect(
      client.execute({
        sql: `INSERT INTO match (id, tournament_id, home_team_id, away_team_id, kickoff_utc, status, home_placeholder, created_at)
              VALUES ('m1','t1',NULL,NULL,'2026-08-01T20:00:00.000Z','scheduled','W74','2026-01-01')`,
        args: [],
      }),
    ).resolves.not.toThrow()
  })
})

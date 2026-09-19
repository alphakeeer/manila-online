import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPool } from '../../apps/server/src/persistence/database.js'
import {
  migrationsAreCurrent,
  runMigrations,
} from '../../apps/server/src/persistence/migrations.js'
import {
  getTestDatabaseUrl,
  resetTestDatabase,
} from '../../apps/server/src/persistence/testDatabase.js'

const testDatabaseUrl = getTestDatabaseUrl()
const migrationsDir = new URL('../../apps/server/migrations/', import.meta.url).pathname

beforeEach(async () => resetTestDatabase(testDatabaseUrl))

describe('PostgreSQL migrations', () => {
  it('applies once and reports current on repeated execution', async () => {
    const pool = createPool(testDatabaseUrl)
    try {
      await runMigrations(pool, migrationsDir)
      await runMigrations(pool, migrationsDir)

      expect(await migrationsAreCurrent(pool, migrationsDir)).toBe(true)
      const result = await pool.query('SELECT id FROM schema_migrations ORDER BY id')
      expect(result.rows).toEqual([
        { id: '001_access_tokens_and_sessions.sql' },
        { id: '002_rooms_and_commands.sql' },
        { id: '003_games_and_events.sql' },
        { id: '004_settlement_private_payload.sql' },
      ])
    } finally {
      await pool.end()
    }
  })

  it('rolls back every migration change when a migration fails', async () => {
    const temporaryDir = await mkdtemp(join(tmpdir(), 'manila-migrations-'))
    const pool = createPool(testDatabaseUrl)
    try {
      await writeFile(
        join(temporaryDir, '001_create_marker.sql'),
        'CREATE TABLE migration_marker (id integer PRIMARY KEY);',
      )
      await writeFile(join(temporaryDir, '002_invalid.sql'), 'THIS IS NOT SQL;')

      await expect(runMigrations(pool, temporaryDir)).rejects.toThrow()
      expect(
        await pool.query("SELECT to_regclass('public.migration_marker') AS name"),
      ).toMatchObject({ rows: [{ name: null }] })
      expect(
        await pool.query("SELECT to_regclass('public.schema_migrations') AS name"),
      ).toMatchObject({ rows: [{ name: null }] })
    } finally {
      await pool.end()
      await rm(temporaryDir, { recursive: true, force: true })
    }
  })
})

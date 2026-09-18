import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import { withTransaction } from './database.js'

const defaultMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations')
const migrationFile = /^(\d{3,})_([a-z0-9_]+)\.sql$/

export interface Migration {
  id: string
  sql: string
}

export async function readMigrations(directory = defaultMigrationsDir): Promise<Migration[]> {
  const files = (await readdir(directory)).filter((file) => migrationFile.test(file)).sort()
  if (files.length === 0) throw new Error('未找到数据库迁移')
  return Promise.all(files.map(async (file) => ({ id: file, sql: await readFile(join(directory, file), 'utf8') })))
}

export async function runMigrations(pool: Pool, directory = defaultMigrationsDir): Promise<void> {
  const migrations = await readMigrations(directory)
  await withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(81726401)')
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    const applied = await client.query<{ id: string }>('SELECT id FROM schema_migrations')
    const appliedIds = new Set(applied.rows.map((row) => row.id))
    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) continue
      await client.query(migration.sql)
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id])
    }
  })
}

export async function migrationsAreCurrent(pool: Pool, directory = defaultMigrationsDir): Promise<boolean> {
  const migrations = await readMigrations(directory)
  const tracking = await pool.query<{ exists: string | null }>("SELECT to_regclass('public.schema_migrations') AS exists")
  if (!tracking.rows[0]?.exists) return false
  const applied = await pool.query<{ id: string }>('SELECT id FROM schema_migrations')
  const appliedIds = new Set(applied.rows.map((row) => row.id))
  return migrations.every((migration) => appliedIds.has(migration.id))
}

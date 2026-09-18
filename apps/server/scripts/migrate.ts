import { loadConfig } from '../src/config.js'
import { createPool } from '../src/persistence/database.js'
import { runMigrations } from '../src/persistence/migrations.js'

const config = loadConfig()
const pool = createPool(config.databaseUrl)
try {
  await runMigrations(pool, config.migrationsDir)
  process.stdout.write('数据库迁移完成\n')
} finally {
  await pool.end()
}

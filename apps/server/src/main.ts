import { loadConfig } from './config.js'
import { createPool } from './persistence/database.js'
import { runMigrations } from './persistence/migrations.js'
import { buildServer } from './server.js'

const config = loadConfig()
const pool = createPool(config.databaseUrl)
const app = buildServer(config, {
  pool,
  ...(config.migrationsDir ? { migrationsDir: config.migrationsDir } : {}),
})

try {
  await runMigrations(pool, config.migrationsDir)
} catch (error) {
  app.log.error({ code: 'STORAGE_UNAVAILABLE', databaseErrorCode: (error as { code?: string }).code }, '数据库迁移不可用；服务保持未就绪')
}

await app.listen({ host: config.host, port: config.port })

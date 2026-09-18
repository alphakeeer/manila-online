import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type { Pool } from 'pg'
import type { ServerConfig } from './config.js'
import { migrationsAreCurrent } from './persistence/migrations.js'

export interface ServerDependencies {
  pool: Pool
  migrationsDir?: string
}

const logger = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.token', 'databaseUrl'],
    censor: '[REDACTED]',
  },
} satisfies NonNullable<FastifyServerOptions['logger']>

export function buildServer(config: ServerConfig, dependencies: ServerDependencies): FastifyInstance {
  const app = Fastify({ logger })
  app.addHook('onClose', async () => {
    await dependencies.pool.end()
  })
  app.get('/health/live', async () => ({ status: 'ok' }))
  app.get('/health/ready', async (_request, reply) => {
    try {
      await dependencies.pool.query('SELECT 1')
      const current = await migrationsAreCurrent(dependencies.pool, dependencies.migrationsDir)
      if (!current) return reply.code(503).send({ code: 'STORAGE_UNAVAILABLE' })
      return { status: 'ready' }
    } catch {
      return reply.code(503).send({ code: 'STORAGE_UNAVAILABLE' })
    }
  })
  return app
}

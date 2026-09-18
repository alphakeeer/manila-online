import cookie from '@fastify/cookie'
import { LoginRequestSchema, SessionResponseSchema } from '@manila/protocol'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type { Pool } from 'pg'
import { digestAccessToken, digestSessionCredential, generateSessionCredential, generateSessionId } from './auth/credentials.js'
import { FixedWindowRateLimiter, type Clock } from './auth/rateLimit.js'
import {
  createSession,
  findAccessTokenByDigest,
  findSessionByDigest,
  revokeSession,
  type SessionRow,
} from './auth/repository.js'
import type { ServerConfig } from './config.js'
import { migrationsAreCurrent } from './persistence/migrations.js'

export interface ServerDependencies {
  pool: Pool
  migrationsDir?: string
  clock?: Clock
}

const sessionCookieName = 'manila_session'
const logger = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.token', 'databaseUrl'],
    censor: '[REDACTED]',
  },
} satisfies NonNullable<FastifyServerOptions['logger']>

function sendError(reply: { code(statusCode: number): { send(body: { code: string }): unknown } }, statusCode: number, code: string) {
  return reply.code(statusCode).send({ code })
}

function validWriteOrigin(origin: string | undefined, config: ServerConfig) {
  return origin !== undefined && config.allowedOrigins.includes(origin)
}

export function buildServer(config: ServerConfig, dependencies: ServerDependencies): FastifyInstance {
  const app = Fastify({ logger })
  const clock = dependencies.clock ?? Date
  const loginLimiter = new FixedWindowRateLimiter(5, 60_000, clock)
  const sessionWriteLimiter = new FixedWindowRateLimiter(30, 60_000, clock)
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    path: '/',
    secure: config.secureCookies,
  }

  app.register(cookie)
  app.addHook('onClose', async () => {
    await dependencies.pool.end()
  })

  async function authenticate(request: { cookies: Record<string, string | undefined> }, reply: Parameters<typeof sendError>[0]) {
    const credential = request.cookies[sessionCookieName]
    if (!credential) {
      sendError(reply, 401, 'AUTH_REQUIRED')
      return null
    }
    try {
      const session = await findSessionByDigest(
        dependencies.pool,
        digestSessionCredential(credential, config.authPepper),
      )
      if (!session || session.revoked_at || session.expires_at.getTime() <= clock.now()) {
        sendError(reply, 401, 'AUTH_REQUIRED')
        return null
      }
      if (session.token_revoked_at) {
        sendError(reply, 401, 'TOKEN_REVOKED')
        return null
      }
      return session
    } catch {
      sendError(reply, 503, 'STORAGE_UNAVAILABLE')
      return null
    }
  }

  app.get('/health/live', async () => ({ status: 'ok' }))
  app.get('/health/ready', async (_request, reply) => {
    try {
      await dependencies.pool.query('SELECT 1')
      const current = await migrationsAreCurrent(dependencies.pool, dependencies.migrationsDir)
      if (!current) return sendError(reply, 503, 'STORAGE_UNAVAILABLE')
      return { status: 'ready' }
    } catch {
      return sendError(reply, 503, 'STORAGE_UNAVAILABLE')
    }
  })

  app.post('/api/session', async (request, reply) => {
    if (!validWriteOrigin(request.headers.origin, config)) {
      return sendError(reply, 403, 'ORIGIN_FORBIDDEN')
    }
    if (!loginLimiter.consume(request.ip)) {
      return sendError(reply, 429, 'RATE_LIMITED')
    }
    const parsed = LoginRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return sendError(reply, 401, 'INVALID_ACCESS_TOKEN')
    }
    try {
      const accessToken = await findAccessTokenByDigest(
        dependencies.pool,
        digestAccessToken(parsed.data.token, config.authPepper),
      )
      if (!accessToken || accessToken.revoked_at) {
        return sendError(reply, 401, 'INVALID_ACCESS_TOKEN')
      }
      const credential = generateSessionCredential()
      const expiresAt = new Date(clock.now() + config.sessionTtlMs)
      await createSession(dependencies.pool, {
        id: generateSessionId(),
        credentialDigest: digestSessionCredential(credential, config.authPepper),
        tokenId: accessToken.id,
        expiresAt,
      })
      reply.setCookie(sessionCookieName, credential, {
        ...cookieOptions,
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      })
      return SessionResponseSchema.parse({ session: { expiresAt: expiresAt.toISOString() } })
    } catch {
      return sendError(reply, 503, 'STORAGE_UNAVAILABLE')
    }
  })

  app.get('/api/session', async (request, reply) => {
    const session = await authenticate(request, reply)
    if (!session) return reply
    return SessionResponseSchema.parse({ session: { expiresAt: session.expires_at.toISOString() } })
  })

  app.delete('/api/session', async (request, reply) => {
    if (!validWriteOrigin(request.headers.origin, config)) {
      return sendError(reply, 403, 'ORIGIN_FORBIDDEN')
    }
    const session = await authenticate(request, reply)
    if (!session) return reply
    if (!sessionWriteLimiter.consume(session.id)) {
      return sendError(reply, 429, 'RATE_LIMITED')
    }
    try {
      await revokeSession(dependencies.pool, session.id)
      reply.clearCookie(sessionCookieName, cookieOptions)
      return reply.code(204).send()
    } catch {
      return sendError(reply, 503, 'STORAGE_UNAVAILABLE')
    }
  })

  return app
}

export type AuthenticatedSession = SessionRow

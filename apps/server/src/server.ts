import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import { existsSync } from 'node:fs'
import type { IncomingHttpHeaders } from 'node:http'
import { resolve } from 'node:path'
import {
  CreateRoomRequestSchema,
  GameCommandRequestSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  LoginRequestSchema,
  StartGameRequestSchema,
  SetPirateVariantRequestSchema,
  SetAutopilotRequestSchema,
  SetReadyRequestSchema,
  SessionResponseSchema,
  SettlementHistorySchema,
} from '@manila/protocol'
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
import { LobbyService, closeInactiveLobbies, type CommandResult, type LobbyErrorCode } from './lobby/service.js'
import { startRevocationListener } from './realtime/revocationListener.js'
import { GameService, type GameCommandResult, type GameErrorCode } from './game/service.js'
import { RoomHub } from './realtime/roomHub.js'
import { SeatAutopilot } from './game/seatAutopilot.js'

export interface ServerDependencies {
  pool: Pool
  migrationsDir?: string
  clock?: Clock
  /** Enables the PostgreSQL revocation listener. Defaults to off in the test environment. */
  revocationListener?: boolean
  /** Periodic inactive-lobby sweep interval. Defaults to 60 seconds in non-test environments. */
  maintenanceIntervalMs?: number
  /** Test-only deterministic game seed source; production keeps the cryptographic default. */
  randomSeed?: () => number
  /** Test-only deterministic starter picker; production keeps the cryptographic default. */
  pickIndex?: (count: number) => number
  /** Test-only override for fixed-window request limits. */
  rateLimits?: { loginMax?: number; sessionWriteMax?: number }
  /** Seat takeover timings; defaults to the config in non-test environments and off in tests unless given. */
  autopilot?: { awayAfterMs: number; thinkMs: number; sweepIntervalMs?: number }
  /** Test-only deterministic choice source for takeover moves. */
  autopilotRandom?: () => number
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

function commandStatus(code: LobbyErrorCode) {
  switch (code) {
    case 'AUTH_REQUIRED':
    case 'TOKEN_REVOKED':
      return 401
    case 'NOT_HOST':
      return 403
    case 'ROOM_NOT_FOUND':
    case 'NOT_MEMBER':
      return 404
    case 'ROOM_FULL':
    case 'ROOM_CLOSED':
    case 'ALREADY_IN_ROOM':
    case 'REVISION_CONFLICT':
    case 'COMMAND_ID_REUSED':
    case 'SEAT_NOT_CLAIMABLE':
      return 409
  }
}

function gameStatus(code: GameErrorCode) {
  switch (code) {
    case 'AUTH_REQUIRED':
    case 'TOKEN_REVOKED': return 401
    case 'NOT_HOST': return 403
    case 'NOT_MEMBER':
    case 'ROOM_NOT_FOUND':
    case 'GAME_NOT_FOUND': return 404
    case 'RULE_REJECTED':
    case 'START_NOT_READY':
    case 'ROOM_CLOSED':
    case 'ROOM_ISOLATED':
    case 'REVISION_CONFLICT':
    case 'COMMAND_ID_REUSED':
    case 'ACTION_NOT_AVAILABLE': return 409
  }
}

export function buildServer(config: ServerConfig, dependencies: ServerDependencies): FastifyInstance {
  const app = Fastify({ logger, trustProxy: config.trustProxy ?? false })
  const clock = dependencies.clock ?? Date
  const loginLimiter = new FixedWindowRateLimiter(dependencies.rateLimits?.loginMax ?? config.loginRateLimitMax ?? 5, 60_000, clock)
  const sessionWriteLimiter = new FixedWindowRateLimiter(dependencies.rateLimits?.sessionWriteMax ?? config.sessionWriteRateLimitMax ?? 30, 60_000, clock)
  const lobby = new LobbyService(dependencies.pool, config.authPepper, () => clock.now())
  const game = new GameService(
    dependencies.pool,
    config.authPepper,
    () => clock.now(),
    (roomCode) => app.log.error({ roomCode }, 'isolated invalid game snapshot'),
    dependencies.randomSeed,
    dependencies.pickIndex,
    dependencies.autopilotRandom,
  )
  const autopilotOptions = dependencies.autopilot ?? (config.environment !== 'test'
    ? { awayAfterMs: config.autopilotAwayMs ?? 30_000, thinkMs: config.autopilotThinkMs ?? 1_500 }
    : null)
  let autopilot: SeatAutopilot | null = null
  const hub = new RoomHub(game, (roomCode) => { void autopilot?.check(roomCode) }, () => clock.now())
  if (autopilotOptions) {
    autopilot = new SeatAutopilot(game, hub, (roomCode) => hub.publish(roomCode), { ...autopilotOptions, now: () => clock.now() },
      (roomCode, error) => app.log.warn({ roomCode, code: 'AUTOPILOT_FAILED', reason: error instanceof Error ? error.message : 'unknown' }, 'seat autopilot move failed'))
  }
  const autopilotSweep = autopilot
    ? setInterval(() => { void autopilot?.sweep() }, dependencies.autopilot?.sweepIntervalMs ?? 10_000)
    : null
  autopilotSweep?.unref?.()
  const heartbeatLimiter = new FixedWindowRateLimiter(6, 60_000, clock)
  const lobbyIdleTimeoutMs = config.lobbyIdleTimeoutMs ?? 24 * 60 * 60 * 1000
  const maintenanceIntervalMs = dependencies.maintenanceIntervalMs ?? 60_000
  let stopRevocationListener: (() => Promise<void>) | null = null
  const revocationListenerReady = (dependencies.revocationListener ?? config.environment !== 'test')
    ? startRevocationListener(dependencies.pool, () => { void hub.revalidate() })
        .then((stop) => { stopRevocationListener = stop })
        .catch(() => { app.log.error({ code: 'REVOCATION_LISTENER_UNAVAILABLE' }, 'revocation listener unavailable') })
    : Promise.resolve()
  app.decorate('revocationListenerReady', revocationListenerReady)
  const maintenanceTimer = config.environment !== 'test' || dependencies.maintenanceIntervalMs !== undefined
    ? setInterval(() => {
        void closeInactiveLobbies(dependencies.pool, lobbyIdleTimeoutMs, clock.now())
          .then((codes) => Promise.all(codes.map((code) => hub.publish(code))))
          .catch(() => app.log.error({ code: 'LOBBY_SWEEP_FAILED' }, 'inactive lobby sweep failed'))
      }, maintenanceIntervalMs)
    : null
  maintenanceTimer?.unref?.()
  app.addHook('onReady', async () => { void autopilot?.sweep() })
  app.addHook('onClose', async () => {
    if (maintenanceTimer) clearInterval(maintenanceTimer)
    if (autopilotSweep) clearInterval(autopilotSweep)
    await autopilot?.stop()
    await revocationListenerReady.catch(() => undefined)
    if (stopRevocationListener) await stopRevocationListener()
    await dependencies.pool.end()
  })
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    path: '/',
    secure: config.secureCookies,
  }

  app.register(cookie)
  app.register(websocket, { options: { maxPayload: 8 * 1024 } })
  if (config.webDistDir) {
    const root = resolve(config.webDistDir)
    if (!existsSync(root)) throw new Error(`WEB_DIST_DIR 不存在：${root}`)
    app.register(fastifyStatic, {
      root,
      prefix: '/',
      wildcard: false,
      cacheControl: false,
      setHeaders(response, filePath) {
        if (filePath.includes(`${resolve(root)}/assets/`)) response.setHeader('cache-control', 'public, max-age=31536000, immutable')
        else response.setHeader('cache-control', 'no-cache')
      },
    })
    app.setNotFoundHandler((request, reply) => {
      const url = request.raw.url ?? ''
      if (request.method === 'GET' && !url.startsWith('/api/') && !url.startsWith('/health/')) return reply.sendFile('index.html')
      return sendError(reply, 404, 'ROOM_NOT_FOUND')
    })
  }

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

  async function authenticateWrite(
    request: { headers: IncomingHttpHeaders; cookies: Record<string, string | undefined> },
    reply: Parameters<typeof sendError>[0],
  ) {
    if (!validWriteOrigin(request.headers.origin, config)) {
      sendError(reply, 403, 'ORIGIN_FORBIDDEN')
      return null
    }
    const session = await authenticate(request, reply)
    if (!session) return null
    if (!sessionWriteLimiter.consume(session.id)) {
      sendError(reply, 429, 'RATE_LIMITED')
      return null
    }
    return session
  }

  function sendCommand(reply: Parameters<typeof sendError>[0], result: CommandResult) {
    if (result.kind === 'accepted') return result.snapshot
    return sendError(reply, commandStatus(result.code), result.code)
  }

  function sendGame(reply: Parameters<typeof sendError>[0], result: GameCommandResult) {
    if (result.kind === 'accepted') return result.snapshot
    return sendError(reply, gameStatus(result.code), result.code)
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
    const session = await authenticateWrite(request, reply)
    if (!session) return reply
    try {
      await revokeSession(dependencies.pool, session.id)
      void hub.revalidate()
      reply.clearCookie(sessionCookieName, cookieOptions)
      return reply.code(204).send()
    } catch {
      return sendError(reply, 503, 'STORAGE_UNAVAILABLE')
    }
  })

  app.get('/api/lobby', async (request, reply) => {
    const session = await authenticate(request, reply)
    if (!session) return reply
    return sendCommand(reply, await lobby.getLobby(session.id))
  })

  app.post('/api/rooms', async (request, reply) => {
    const session = await authenticateWrite(request, reply)
    if (!session) return reply
    const parsed = CreateRoomRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR')
    return sendCommand(reply, await lobby.createRoom(session.id, {
      ...parsed.data,
      pirateVariant: parsed.data.pirateVariant ?? 'standard',
    }))
  })

  app.post('/api/rooms/join', async (request, reply) => {
    const session = await authenticateWrite(request, reply)
    if (!session) return reply
    const parsed = JoinRoomRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR')
    const result = await lobby.joinRoom(session.id, parsed.data)
    // A reclaimed seat changes who drives it; let the table see the bot badge disappear.
    if (result.kind === 'accepted' && result.snapshot.room?.status === 'playing') void hub.publish(result.snapshot.room.code)
    return sendCommand(reply, result)
  })

  app.post('/api/rooms/:roomCode/ready', async (request, reply) => {
    const session = await authenticateWrite(request, reply)
    if (!session) return reply
    const parsed = SetReadyRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR')
    const roomCode = String((request.params as { roomCode?: string }).roomCode ?? '').trim().toUpperCase()
    return sendCommand(reply, await lobby.setReady(session.id, roomCode, parsed.data))
  })

  app.patch('/api/rooms/:roomCode/config', async (request, reply) => {
    const session = await authenticateWrite(request, reply)
    if (!session) return reply
    const parsed = SetPirateVariantRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR')
    const roomCode = String((request.params as { roomCode?: string }).roomCode ?? '').trim().toUpperCase()
    return sendCommand(reply, await lobby.setPirateVariant(session.id, roomCode, parsed.data))
  })

  app.delete('/api/rooms/:roomCode/members/me', async (request, reply) => {
    const session = await authenticateWrite(request, reply)
    if (!session) return reply
    const parsed = LeaveRoomRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR')
    const roomCode = String((request.params as { roomCode?: string }).roomCode ?? '').trim().toUpperCase()
    return sendCommand(reply, await lobby.leaveRoom(session.id, roomCode, parsed.data))
  })

  app.get('/api/rooms/:roomCode/snapshot', async (request, reply) => {
    const session = await authenticate(request, reply)
    if (!session) return reply
    const roomCode = String((request.params as { roomCode?: string }).roomCode ?? '').trim().toUpperCase()
    return sendGame(reply, await game.latest(session.id, roomCode))
  })

  app.get('/api/rooms/:roomCode/history', async (request, reply) => {
    const session = await authenticate(request, reply)
    if (!session) return reply
    const roomCode = String((request.params as { roomCode?: string }).roomCode ?? '').trim().toUpperCase()
    const result = await game.history(session.id, roomCode)
    if (result.kind === 'rejected') return sendError(reply, gameStatus(result.code), result.code)
    return SettlementHistorySchema.parse(result.history)
  })

  app.post('/api/rooms/:roomCode/start', async (request, reply) => {
    const session = await authenticateWrite(request, reply)
    if (!session) return reply
    const parsed = StartGameRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR')
    const roomCode = String((request.params as { roomCode?: string }).roomCode ?? '').trim().toUpperCase()
    const result = await game.start(session.id, roomCode, parsed.data)
    if (result.kind === 'accepted') await hub.publish(roomCode)
    return sendGame(reply, result)
  })

  app.post('/api/rooms/:roomCode/autopilot', async (request, reply) => {
    const session = await authenticateWrite(request, reply)
    if (!session) return reply
    const parsed = SetAutopilotRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR')
    const roomCode = String((request.params as { roomCode?: string }).roomCode ?? '').trim().toUpperCase()
    const result = await game.setAutopilot(session.id, roomCode, parsed.data.enabled)
    if (result.kind === 'accepted') await hub.publish(roomCode)
    return sendGame(reply, result)
  })

  app.post('/api/rooms/:roomCode/commands', async (request, reply) => {
    const session = await authenticateWrite(request, reply)
    if (!session) return reply
    const parsed = GameCommandRequestSchema.safeParse(request.body)
    if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR')
    const roomCode = String((request.params as { roomCode?: string }).roomCode ?? '').trim().toUpperCase()
    const result = await game.command(session.id, roomCode, parsed.data)
    if (result.kind === 'accepted') await hub.publish(roomCode)
    return sendGame(reply, result)
  })

  app.after(() => {
    app.get('/api/rooms/:roomCode/subscribe', { websocket: true }, (socket, request) => {
    const originHeader = request.headers.origin ?? request.headers['sec-websocket-origin']
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader
    if (!validWriteOrigin(origin, config)) {
      socket.close(1008)
      return
    }
    const credential = request.cookies[sessionCookieName]
    if (!credential) {
      socket.close(1008)
      return
    }
    const roomCode = String((request.params as { roomCode?: string }).roomCode ?? '').trim().toUpperCase()
    void findSessionByDigest(dependencies.pool, digestSessionCredential(credential, config.authPepper))
      .then((session) => {
        if (!session || session.revoked_at || session.expires_at.getTime() <= clock.now() || session.token_revoked_at) {
          socket.close(1008)
          return
        }
        void hub.subscribe(roomCode, session.id, socket)
      })
      .catch(() => socket.close(1011))
    socket.on('message', (data) => {
      const bytes = Array.isArray(data)
        ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
        : typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
      if (bytes > 8 * 1024 || !credential) {
        socket.close(1009)
        return
      }
      let heartbeat: { type?: unknown; revision?: unknown }
      try {
        const text = typeof data === 'string' ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]).toString()
        heartbeat = JSON.parse(text) as { type?: unknown; revision?: unknown }
      } catch { socket.close(1008); return }
      if (heartbeat.type !== 'heartbeat' || !Number.isInteger(heartbeat.revision) || (heartbeat.revision as number) < 0) {
        socket.close(1008)
        return
      }
      void findSessionByDigest(dependencies.pool, digestSessionCredential(credential, config.authPepper))
        .then((session) => {
          if (!session || !heartbeatLimiter.consume(session.id)) { socket.close(1008); return }
          void hub.heartbeat(roomCode, session.id, heartbeat.revision as number, socket)
        })
        .catch(() => socket.close(1011))
    })
    })
  })

  return app
}

export type AuthenticatedSession = SessionRow

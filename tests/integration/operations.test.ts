import WebSocket from 'ws'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildServer } from '../../apps/server/src/server.js'
import { createPool } from '../../apps/server/src/persistence/database.js'
import { runMigrations } from '../../apps/server/src/persistence/migrations.js'
import { getTestDatabaseUrl, resetTestDatabase } from '../../apps/server/src/persistence/testDatabase.js'
import { createAccessToken, revokeAccessToken } from '../../apps/server/src/auth/repository.js'
import { digestAccessToken } from '../../apps/server/src/auth/credentials.js'
import { closeInactiveLobbies, closeRoomByCode } from '../../apps/server/src/lobby/service.js'

const testDatabaseUrl = getTestDatabaseUrl()
const migrationsDir = new URL('../../apps/server/migrations/', import.meta.url).pathname
const origin = 'http://localhost:5173'
const token = '23456789'
let pool: ReturnType<typeof createPool>

function cookie(response: unknown) {
  const header = (response as { headers?: { 'set-cookie'?: unknown } }).headers?.['set-cookie']
  const value = Array.isArray(header) ? header[0] : typeof header === 'string' ? header : undefined
  if (!value) throw new Error('missing session cookie')
  return value.split(';', 1)[0]!
}

beforeEach(async () => {
  await resetTestDatabase(testDatabaseUrl)
  pool = createPool(testDatabaseUrl)
  await runMigrations(pool, migrationsDir)
  await createAccessToken(pool, { id: 'token', digest: digestAccessToken(token, 'test-pepper'), label: null })
})

function build(options: { revocationListener?: boolean } = {}) {
  return buildServer(
    { environment: 'test', host: '127.0.0.1', port: 3000, databaseUrl: testDatabaseUrl, authPepper: 'test-pepper', allowedOrigins: [origin], secureCookies: false, sessionTtlMs: 604_800_000 },
    { pool, randomSeed: () => 31, pickIndex: () => 0, rateLimits: { sessionWriteMax: 10_000 }, ...options },
  )
}

async function session(app: ReturnType<typeof build>, index: number) {
  return cookie(await app.inject({ method: 'POST', url: '/api/session', remoteAddress: `127.0.0.${index + 1}`, headers: { origin }, payload: { token } }))
}
async function write(app: ReturnType<typeof build>, sessionCookie: string, url: string, payload: object) {
  return app.inject({ method: 'POST', url, headers: { origin, cookie: sessionCookie }, payload })
}

async function startGame(app: ReturnType<typeof build>) {
  const sessions = [await session(app, 0), await session(app, 1), await session(app, 2)]
  const created = await write(app, sessions[0]!, '/api/rooms', { commandId: 'create', nickname: 'P1' })
  const code = created.json().room.code as string
  await write(app, sessions[1]!, '/api/rooms/join', { commandId: 'join-1', roomCode: code, nickname: 'P2' })
  await write(app, sessions[2]!, '/api/rooms/join', { commandId: 'join-2', roomCode: code, nickname: 'P3' })
  for (const [index, revision] of [[0, 3], [1, 4], [2, 5]] as const) {
    await write(app, sessions[index]!, `/api/rooms/${code}/ready`, { commandId: `ready-${index}`, expectedRevision: revision, ready: true })
  }
  await write(app, sessions[0]!, `/api/rooms/${code}/start`, { protocolVersion: 1, commandId: 'start', expectedRevision: 6 })
  return { sessions, code }
}

describe('room lifecycle administration', () => {
  it('keeps an administrator-closed game snapshot readable while rejecting new commands', async () => {
    const app = build()
    try {
      const { sessions, code } = await startGame(app)
      const closed = await closeRoomByCode(pool, code)
      expect(closed).toBe(true)

      const snapshot = await app.inject({ method: 'GET', url: `/api/rooms/${code}/snapshot`, headers: { cookie: sessions[0]! } })
      expect(snapshot.statusCode).toBe(200)
      expect(snapshot.json()).toMatchObject({ room: { status: 'closed', readOnly: true }, public: { phase: { kind: 'auction' } } })

      const command = await write(app, sessions[0]!, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: 'after-close', expectedRevision: snapshot.json().room.revision, action: { type: 'passAuction' } })
      expect(command.statusCode).toBe(409)
      expect(command.json()).toEqual({ code: 'ROOM_CLOSED' })

      const history = await app.inject({ method: 'GET', url: `/api/rooms/${code}/history`, headers: { cookie: sessions[0]! } })
      expect(history.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('closes idle lobbies and releases their members without touching a playing game', async () => {
    const app = build()
    try {
      const host = await session(app, 0)
      const created = await write(app, host, '/api/rooms', { commandId: 'create', nickname: 'Host' })
      const idleCode = created.json().room.code as string
      const { code: playingCode } = await startGame(app)

      const closedCodes = await closeInactiveLobbies(pool, 0, Date.now() + 60_000)
      expect(closedCodes).toContain(idleCode)
      expect(closedCodes).not.toContain(playingCode)

      const lobby = await app.inject({ method: 'GET', url: '/api/lobby', headers: { cookie: host } })
      expect(lobby.json().room).toBeNull()
      const room = await pool.query<{ status: string }>('SELECT status FROM rooms WHERE code = $1', [idleCode])
      expect(room.rows[0]?.status).toBe('closed')
      const playing = await pool.query<{ status: string }>('SELECT status FROM rooms WHERE code = $1', [playingCode])
      expect(playing.rows[0]?.status).toBe('playing')
    } finally {
      await app.close()
    }
  })
})

describe('restart recovery', () => {
  it('keeps the committed revision and decisions after a process restart', async () => {
    const first = build()
    const { sessions, code } = await startGame(first)
    const before = await first.inject({ method: 'GET', url: `/api/rooms/${code}/snapshot`, headers: { cookie: sessions[0]! } })
    expect(before.statusCode).toBe(200)
    await first.close()

    const secondPool = createPool(testDatabaseUrl)
    const second = buildServer(
      { environment: 'test', host: '127.0.0.1', port: 3000, databaseUrl: testDatabaseUrl, authPepper: 'test-pepper', allowedOrigins: [origin], secureCookies: false, sessionTtlMs: 604_800_000 },
      { pool: secondPool, randomSeed: () => 99, pickIndex: () => 0 },
    )
    try {
      const after = await second.inject({ method: 'GET', url: `/api/rooms/${code}/snapshot`, headers: { cookie: sessions[0]! } })
      expect(after.statusCode).toBe(200)
      expect(after.json()).toEqual(before.json())
    } finally {
      await second.close()
    }
  })
})

describe('token revocation', () => {
  it('rejects subsequent API access immediately after the host CLI revokes a token', async () => {
    const app = build()
    try {
      const host = await session(app, 0)
      expect((await revokeAccessToken(pool, 'token'))).toBe(true)
      const view = await app.inject({ method: 'GET', url: '/api/lobby', headers: { cookie: host } })
      expect(view.statusCode).toBe(401)
      expect(view.json()).toEqual({ code: 'TOKEN_REVOKED' })
      const command = await write(app, host, '/api/rooms/AAAA2222/commands', { protocolVersion: 1, commandId: 'revoked', expectedRevision: 0, action: { type: 'passAuction' } })
      expect(command.statusCode).toBe(401)
      expect(command.json()).toEqual({ code: 'TOKEN_REVOKED' })
    } finally {
      await app.close()
    }
  })

  it('closes an established WebSocket when the token is revoked out of process', async () => {
    const app = build({ revocationListener: true })
    try {
      await (app as unknown as { revocationListenerReady: Promise<void> }).revocationListenerReady
      await app.listen({ host: '127.0.0.1', port: 0 })
      const { sessions, code } = await startGame(app)
      const address = app.server.address() as { port: number }
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/rooms/${code}/subscribe`, { origin, headers: { cookie: sessions[0]! } })
      const firstMessage = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('websocket snapshot timeout')), 3_000)
        socket.once('message', (data) => { clearTimeout(timer); resolve(data.toString()) })
      })
      expect(JSON.parse(firstMessage)).toMatchObject({ type: 'room.snapshot' })

      const closed = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('websocket close timeout')), 3_000)
        socket.once('close', (codeNumber) => { clearTimeout(timer); resolve(codeNumber) })
      })
      await revokeAccessToken(pool, 'token')
      await expect(closed).resolves.toBe(1008)
    } finally {
      await app.close()
    }
  })
})

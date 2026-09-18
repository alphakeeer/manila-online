import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildServer } from '../../apps/server/src/server.js'
import { createPool } from '../../apps/server/src/persistence/database.js'
import { runMigrations } from '../../apps/server/src/persistence/migrations.js'
import { getTestDatabaseUrl, resetTestDatabase } from '../../apps/server/src/persistence/testDatabase.js'
import { createAccessToken } from '../../apps/server/src/auth/repository.js'
import { digestAccessToken } from '../../apps/server/src/auth/credentials.js'

const testDatabaseUrl = getTestDatabaseUrl()
const migrationsDir = new URL('../../apps/server/migrations/', import.meta.url).pathname
const origin = 'http://localhost:5173'
const token = '23456789'
let pool: ReturnType<typeof createPool>
let app: ReturnType<typeof buildServer>

function cookie(response: unknown) {
  const header = (response as { headers?: { 'set-cookie'?: unknown } }).headers?.['set-cookie']
  const value = Array.isArray(header) ? header[0] : typeof header === 'string' ? header : undefined
  if (!value) throw new Error('missing session cookie')
  return value.split(';', 1)[0]
}

beforeEach(async () => {
  await resetTestDatabase(testDatabaseUrl)
  pool = createPool(testDatabaseUrl)
  await runMigrations(pool, migrationsDir)
  await createAccessToken(pool, { id: 'token', digest: digestAccessToken(token, 'test-pepper'), label: null })
  app = buildServer({ environment: 'test', host: '127.0.0.1', port: 3000, databaseUrl: testDatabaseUrl, authPepper: 'test-pepper', allowedOrigins: [origin], secureCookies: false, sessionTtlMs: 604_800_000 }, { pool })
})
afterEach(async () => app.close())

async function session(address: string) {
  return cookie(await app.inject({ method: 'POST', url: '/api/session', remoteAddress: address, headers: { origin }, payload: { token } }))
}
async function write(value: string, url: string, payload: object) {
  return app.inject({ method: 'POST', url, headers: { origin, cookie: value }, payload })
}

describe('authoritative first auction', () => {
  it('starts exactly one prepared game and projects private auction state only to its actor', async () => {
    const host = await session('127.0.0.1')
    const one = await session('127.0.0.2')
    const two = await session('127.0.0.3')
    const created = await write(host, '/api/rooms', { commandId: 'create', nickname: 'Host' })
    const code = created.json().room.code as string
    await write(one, '/api/rooms/join', { commandId: 'join-one', roomCode: code, nickname: 'One' })
    await write(two, '/api/rooms/join', { commandId: 'join-two', roomCode: code, nickname: 'Two' })
    for (const [value, revision, id] of [[host, 3, 'ready-host'], [one, 4, 'ready-one'], [two, 5, 'ready-two']] as const) {
      expect((await write(value, `/api/rooms/${code}/ready`, { commandId: id, expectedRevision: revision, ready: true })).statusCode).toBe(200)
    }
    const started = await write(host, `/api/rooms/${code}/start`, { protocolVersion: 1, commandId: 'start', expectedRevision: 6 })
    expect(started.statusCode).toBe(200)
    expect(started.json()).toMatchObject({ room: { status: 'playing', revision: 7 }, public: { phase: { kind: 'auction', currentSeat: expect.any(Number) } } })
    expect(JSON.stringify(started.json())).not.toContain('seed')
    expect(JSON.stringify(started.json())).not.toContain('player-')

    const firstSeat = started.json().public.phase.currentSeat as number
    const actors = [host, one, two]
    const actor = actors[firstSeat - 1]!
    const waiting = actors.find((value) => value !== actor)!
    const actorSnapshot = await app.inject({ method: 'GET', url: `/api/rooms/${code}/snapshot`, headers: { cookie: actor } })
    const waitingSnapshot = await app.inject({ method: 'GET', url: `/api/rooms/${code}/snapshot`, headers: { cookie: waiting } })
    expect(actorSnapshot.json().decision).toMatchObject({ kind: 'auction', minimumBid: 1 })
    expect(waitingSnapshot.json().decision).toBeNull()
    expect(JSON.stringify(waitingSnapshot.json())).not.toContain(JSON.stringify(actorSnapshot.json().self.shares[0]?.id))

    const bid = { protocolVersion: 1, commandId: 'bid-once', expectedRevision: 7, action: { type: 'bid', amount: 1, mortgageShareIds: [] } }
    const accepted = await write(actor, `/api/rooms/${code}/commands`, bid)
    const replay = await write(actor, `/api/rooms/${code}/commands`, bid)
    expect(accepted.statusCode).toBe(200)
    expect(replay.json()).toEqual(accepted.json())
    const collision = await write(actor, `/api/rooms/${code}/commands`, { ...bid, action: { type: 'bid', amount: 2, mortgageShareIds: [] } })
    expect(collision.json()).toEqual({ code: 'COMMAND_ID_REUSED' })
    await pool.query('UPDATE games SET protocol_version = 999 WHERE room_id = (SELECT id FROM rooms WHERE code = $1)', [code])
    const isolated = await app.inject({ method: 'GET', url: `/api/rooms/${code}/snapshot`, headers: { cookie: actor } })
    expect(isolated.json()).toEqual({ code: 'ROOM_ISOLATED' })
    expect((await pool.query<{ status: string }>('SELECT status FROM rooms WHERE code = $1', [code])).rows[0]?.status).toBe('isolated')
  })

  it('rejects unprepared starts, stale concurrent commands, and unavailable actions without state mutation', async () => {
    const host = await session('127.0.0.1')
    const created = await write(host, '/api/rooms', { commandId: 'create', nickname: 'Host' })
    const code = created.json().room.code as string
    expect((await write(host, `/api/rooms/${code}/start`, { protocolVersion: 1, commandId: 'early', expectedRevision: 1 })).json()).toEqual({ code: 'START_NOT_READY' })
    expect((await write(host, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: 'future', expectedRevision: 1, action: { type: 'buyShare' } })).json()).toEqual({ code: 'ROOM_CLOSED' })
  })
})

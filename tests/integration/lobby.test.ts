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

function cookieFrom(response: unknown) {
  const header = (response as { headers?: { 'set-cookie'?: unknown } }).headers?.['set-cookie']
  const value = Array.isArray(header) ? header[0] : typeof header === 'string' ? header : undefined
  if (!value) throw new Error('expected session cookie')
  return value.split(';', 1)[0]
}

beforeEach(async () => {
  await resetTestDatabase(testDatabaseUrl)
  pool = createPool(testDatabaseUrl)
  await runMigrations(pool, migrationsDir)
  await createAccessToken(pool, { id: 'shared-token', digest: digestAccessToken(token, 'test-only-pepper'), label: null })
  app = buildServer({
    environment: 'test', host: '127.0.0.1', port: 3000, databaseUrl: testDatabaseUrl,
    authPepper: 'test-only-pepper', allowedOrigins: [origin], secureCookies: false, sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  }, { pool })
})

afterEach(async () => app.close())

async function session() {
  return cookieFrom(await app.inject({ method: 'POST', url: '/api/session', headers: { origin }, payload: { token } }))
}

async function write(cookie: string, method: 'POST' | 'PATCH' | 'DELETE', url: string, payload: object) {
  return app.inject({ method, url, headers: { origin, cookie }, payload })
}

describe('persistent lobby', () => {
  it('persists create, join, ready, host transfer, config reset, and safe leave replay', async () => {
    const host = await session()
    const created = await write(host, 'POST', '/api/rooms', { commandId: 'create-1', nickname: 'Alice', pirateVariant: 'standard' })
    expect(created.statusCode).toBe(200)
    const room = created.json().room
    expect(room).toMatchObject({ revision: 1, members: [{ nickname: 'Alice', seat: 1, isHost: true }] })
    const code = room.code as string

    const guest = await session()
    const joined = await write(guest, 'POST', '/api/rooms/join', { commandId: 'join-1', roomCode: code, nickname: 'Bob' })
    expect(joined.json().room).toMatchObject({ revision: 2, members: expect.arrayContaining([expect.objectContaining({ nickname: 'Bob', seat: 2 })]) })
    const ready = await write(guest, 'POST', `/api/rooms/${code}/ready`, { commandId: 'ready-1', expectedRevision: 2, ready: true })
    expect(ready.json().room).toMatchObject({ revision: 3, members: expect.arrayContaining([expect.objectContaining({ nickname: 'Bob', ready: true })]) })

    const denied = await write(guest, 'PATCH', `/api/rooms/${code}/config`, { commandId: 'not-host', expectedRevision: 3, pirateVariant: 'strengthened' })
    expect(denied.json()).toEqual({ code: 'NOT_HOST' })
    expect((await write(guest, 'PATCH', `/api/rooms/${code}/config`, { commandId: 'not-host', expectedRevision: 3, pirateVariant: 'strengthened' })).json()).toEqual({ code: 'NOT_HOST' })
    const configured = await write(host, 'PATCH', `/api/rooms/${code}/config`, { commandId: 'config-1', expectedRevision: 3, pirateVariant: 'strengthened' })
    expect(configured.json().room).toMatchObject({ revision: 4, pirateVariant: 'strengthened', members: expect.arrayContaining([expect.objectContaining({ nickname: 'Bob', ready: false })]) })

    const left = await write(host, 'DELETE', `/api/rooms/${code}/members/me`, { commandId: 'leave-1', expectedRevision: 4 })
    expect(left.json().room).toBeNull()
    expect((await write(host, 'DELETE', `/api/rooms/${code}/members/me`, { commandId: 'leave-1', expectedRevision: 4 })).json().room).toBeNull()
    const lobby = await app.inject({ method: 'GET', url: '/api/lobby', headers: { cookie: guest } })
    expect(lobby.json().room).toMatchObject({ revision: 5, members: [expect.objectContaining({ nickname: 'Bob', isHost: true })] })
  })

  it('serializes a contested final seat and rejects stale or reused commands', async () => {
    const host = await session()
    const created = await write(host, 'POST', '/api/rooms', { commandId: 'create-2', nickname: 'Host' })
    const code = created.json().room.code as string
    const guests = await Promise.all([session(), session(), session(), session(), session()])
    const joins = await Promise.all(guests.map((cookie, index) => write(cookie, 'POST', '/api/rooms/join', { commandId: `join-${index}`, roomCode: code, nickname: `Guest ${index}` })))
    expect(joins.filter((response) => response.statusCode === 200)).toHaveLength(4)
    expect(joins.filter((response) => response.json().code === 'ROOM_FULL')).toHaveLength(1)

    const winner = guests[joins.findIndex((response) => response.statusCode === 200)]!
    const lobby = await app.inject({ method: 'GET', url: '/api/lobby', headers: { cookie: winner } })
    const revision = lobby.json().room.revision as number
    const first = await write(winner, 'POST', `/api/rooms/${code}/ready`, { commandId: 'ready-replay', expectedRevision: revision, ready: true })
    const replay = await write(winner, 'POST', `/api/rooms/${code}/ready`, { commandId: 'ready-replay', expectedRevision: revision, ready: true })
    expect(replay.json()).toEqual(first.json())
    const reuse = await write(winner, 'POST', `/api/rooms/${code}/ready`, { commandId: 'ready-replay', expectedRevision: revision + 1, ready: false })
    expect(reuse.json()).toEqual({ code: 'COMMAND_ID_REUSED' })
    const stale = await write(winner, 'POST', `/api/rooms/${code}/ready`, { commandId: 'stale', expectedRevision: revision, ready: false })
    expect(stale.json()).toEqual({ code: 'REVISION_CONFLICT' })
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GameRoomSnapshotSchema, type GameRoomSnapshot } from '@manila/protocol'
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
  return value.split(';', 1)[0]!
}
async function session(index: number) {
  return cookie(await app.inject({ method: 'POST', url: '/api/session', remoteAddress: `127.0.0.${index + 1}`, headers: { origin }, payload: { token } }))
}
async function write(sessionCookie: string, url: string, payload: object) {
  return app.inject({ method: 'POST', url, headers: { origin, cookie: sessionCookie }, payload })
}
async function snapshot(sessionCookie: string, code: string) {
  const response = await app.inject({ method: 'GET', url: `/api/rooms/${code}/snapshot`, headers: { cookie: sessionCookie } })
  const parsed = GameRoomSnapshotSchema.safeParse(response.json())
  if (!parsed.success) throw new Error(`snapshot unavailable: ${response.statusCode} ${response.body}`)
  return parsed.data
}

beforeEach(async () => {
  await resetTestDatabase(testDatabaseUrl)
  pool = createPool(testDatabaseUrl)
  await runMigrations(pool, migrationsDir)
  await createAccessToken(pool, { id: 'token', digest: digestAccessToken(token, 'test-pepper'), label: null })
  app = buildServer(
    { environment: 'test', host: '127.0.0.1', port: 3000, databaseUrl: testDatabaseUrl, authPepper: 'test-pepper', allowedOrigins: [origin], secureCookies: false, sessionTtlMs: 604_800_000 },
    { pool, randomSeed: () => 31, pickIndex: () => 0, rateLimits: { sessionWriteMax: 10_000 } },
  )
})
afterEach(async () => app.close())

async function startedGame(): Promise<{ sessions: string[]; code: string }> {
  const sessions = [await session(0), await session(1), await session(2)]
  const created = await write(sessions[0]!, '/api/rooms', { commandId: 'create', nickname: 'P1' })
  const code = created.json().room.code as string
  await write(sessions[1]!, '/api/rooms/join', { commandId: 'join-1', roomCode: code, nickname: 'P2' })
  await write(sessions[2]!, '/api/rooms/join', { commandId: 'join-2', roomCode: code, nickname: 'P3' })
  for (const [index, revision] of [[0, 3], [1, 4], [2, 5]] as const) {
    expect((await write(sessions[index]!, `/api/rooms/${code}/ready`, { commandId: `ready-${index}`, expectedRevision: revision, ready: true })).statusCode).toBe(200)
  }
  expect((await write(sessions[0]!, `/api/rooms/${code}/start`, { protocolVersion: 1, commandId: 'start', expectedRevision: 6 })).statusCode).toBe(200)
  return { sessions, code }
}

describe('independent finance commands', () => {
  it('lets a non-acting player mortgage and redeem while the auction is waiting', async () => {
    const { sessions, code } = await startedGame()
    const views = await Promise.all(sessions.map((value) => snapshot(value, code)))
    const actorIndex = views.findIndex((view) => view.decision?.kind === 'auction')
    const waiterIndex = views.findIndex((view, index) => index !== actorIndex && view.self.shares.length > 0)
    expect(actorIndex).toBeGreaterThanOrEqual(0)
    expect(waiterIndex).toBeGreaterThanOrEqual(0)
    const actor = sessions[actorIndex]!
    const waiter = sessions[waiterIndex]!
    const before = views[waiterIndex]!
    const shareId = before.self.shares[0]!.id
    const phaseBefore = before.public.phase.kind
    const actorRevision = views[actorIndex]!.room.revision

    const mortgaged = await write(waiter, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: 'mortgage', expectedRevision: before.room.revision, action: { type: 'mortgageShare', shareId } })
    expect(mortgaged.statusCode).toBe(200)
    const afterMortgage = await snapshot(waiter, code)
    expect(afterMortgage.self.shares.find((share) => share.id === shareId)?.mortgaged).toBe(true)
    expect(afterMortgage.self.pesos).toBe(before.self.pesos + 12)
    expect(afterMortgage.public.phase.kind).toBe(phaseBefore)
    expect(afterMortgage.room.revision).toBe(before.room.revision + 1)

    const redeemed = await write(waiter, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: 'redeem', expectedRevision: afterMortgage.room.revision, action: { type: 'redeemShare', shareId } })
    expect(redeemed.statusCode).toBe(200)
    const afterRedeem = await snapshot(waiter, code)
    expect(afterRedeem.self.shares.find((share) => share.id === shareId)?.mortgaged).toBe(false)
    expect(afterRedeem.self.pesos).toBe(afterMortgage.self.pesos - 15)

    const forged = await write(waiter, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: 'forged', expectedRevision: afterRedeem.room.revision, action: { type: 'mortgageShare', shareId: 'not-my-share' } })
    expect(forged.statusCode).toBe(409)
    expect(forged.json()).toEqual({ code: 'RULE_REJECTED' })
    expect((await snapshot(waiter, code)).room.revision).toBe(afterRedeem.room.revision)

    const stale = await write(actor, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: 'stale-bid', expectedRevision: actorRevision, action: { type: 'bid', amount: 1, mortgageShareIds: [] } })
    expect(stale.json()).toEqual({ code: 'REVISION_CONFLICT' })
    const refreshed = await snapshot(actor, code)
    const bid = await write(actor, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: 'fresh-bid', expectedRevision: refreshed.room.revision, action: { type: 'bid', amount: 1, mortgageShareIds: [] } })
    expect(bid.statusCode).toBe(200)
  })

  it('rejects a second mortgage of the same share without a second payout', async () => {
    const { sessions, code } = await startedGame()
    const views = await Promise.all(sessions.map((value) => snapshot(value, code)))
    const waiterIndex = views.findIndex((view) => view.decision === null && view.self.shares.length > 0)
    const waiter = sessions[waiterIndex]!
    const view = views[waiterIndex]!
    const shareId = view.self.shares[0]!.id
    const first = await write(waiter, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: 'mortgage-1', expectedRevision: view.room.revision, action: { type: 'mortgageShare', shareId } })
    expect(first.statusCode).toBe(200)
    const afterFirst = await snapshot(waiter, code)
    const second = await write(waiter, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: 'mortgage-2', expectedRevision: afterFirst.room.revision, action: { type: 'mortgageShare', shareId } })
    expect(second.json()).toEqual({ code: 'RULE_REJECTED' })
    const afterSecond = await snapshot(waiter, code)
    expect(afterSecond.self.pesos).toBe(afterFirst.self.pesos)
    expect(afterSecond.room.revision).toBe(afterFirst.room.revision)
  })
})

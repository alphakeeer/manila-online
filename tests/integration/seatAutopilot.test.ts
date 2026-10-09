import WebSocket from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildServer } from '../../apps/server/src/server.js'
import { createPool } from '../../apps/server/src/persistence/database.js'
import { runMigrations } from '../../apps/server/src/persistence/migrations.js'
import { getTestDatabaseUrl, resetTestDatabase } from '../../apps/server/src/persistence/testDatabase.js'
import { createAccessToken } from '../../apps/server/src/auth/repository.js'
import { digestAccessToken } from '../../apps/server/src/auth/credentials.js'

const databaseUrl = getTestDatabaseUrl()
const migrationsDir = new URL('../../apps/server/migrations/', import.meta.url).pathname
const origin = 'http://localhost:5173'
let pool: ReturnType<typeof createPool>
let app: ReturnType<typeof buildServer>
let address = 0

type Snapshot = { room: { revision: number; status: string }; public: { phase: { currentSeat: number | null; kind: string }; players: Array<{ seat: number; nickname: string; autopilot: string | null }>; standings: unknown }; self: { seat: number }; decision: unknown }

function getCookie(response: { headers: Record<string, unknown> }) {
  const raw = response.headers['set-cookie']
  return (Array.isArray(raw) ? raw[0] : raw)!.split(';', 1)[0]!
}
async function login(remoteAddress: string) {
  return getCookie(await app.inject({ method: 'POST', url: '/api/session', remoteAddress, headers: { origin }, payload: { token: '23456789' } }))
}
const post = (cookie: string, url: string, payload: object) => app.inject({ method: 'POST', url, headers: { origin, cookie }, payload })
const snapshot = async (cookie: string, code: string) => (await app.inject({ method: 'GET', url: `/api/rooms/${code}/snapshot`, headers: { cookie } })).json() as Snapshot
async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, timeout = 8_000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('condition not reached')
}
function seeded(seed: number) {
  let state = seed
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
}

/** Three seated players; returns cookies indexed by seat - 1. */
async function startTable() {
  const cookies = [await login('127.0.0.1'), await login('127.0.0.2'), await login('127.0.0.3')]
  const code = (await post(cookies[0]!, '/api/rooms', { commandId: 'create', nickname: 'Host' })).json().room.code as string
  await post(cookies[1]!, '/api/rooms/join', { commandId: 'join-1', roomCode: code, nickname: 'One' })
  await post(cookies[2]!, '/api/rooms/join', { commandId: 'join-2', roomCode: code, nickname: 'Two' })
  for (const [index, revision] of [[0, 3], [1, 4], [2, 5]] as const) await post(cookies[index]!, `/api/rooms/${code}/ready`, { commandId: `ready-${index}`, expectedRevision: revision, ready: true })
  const started = await post(cookies[0]!, `/api/rooms/${code}/start`, { protocolVersion: 1, commandId: 'start', expectedRevision: 6 })
  expect(started.statusCode).toBe(200)
  return { code, cookies }
}

beforeEach(async () => {
  await resetTestDatabase(databaseUrl)
  pool = createPool(databaseUrl)
  await runMigrations(pool, migrationsDir)
  await createAccessToken(pool, { id: 'token', digest: digestAccessToken('23456789', 'test-pepper'), label: null })
  app = buildServer(
    { environment: 'test', host: '127.0.0.1', port: 3000, databaseUrl, authPepper: 'test-pepper', allowedOrigins: [origin], secureCookies: false, sessionTtlMs: 604_800_000 },
    { pool, autopilot: { awayAfterMs: 300, thinkMs: 5, sweepIntervalMs: 100 }, autopilotRandom: seeded(7), rateLimits: { loginMax: 100, sessionWriteMax: 10_000 } },
  )
  await app.listen({ host: '127.0.0.1', port: 0 })
  address = (app.server.address() as { port: number }).port
})
afterEach(async () => app.close())

describe('seat autopilot', () => {
  it('plays steadily for a seat that asked for it and hands it back when the player acts', async () => {
    const { code, cookies } = await startTable()
    const first = await snapshot(cookies[0]!, code)
    const actor = first.public.phase.currentSeat!
    const cookie = cookies[actor - 1]!
    const toggled = await post(cookie, `/api/rooms/${code}/autopilot`, { enabled: true })
    expect(toggled.statusCode).toBe(200)
    expect((toggled.json() as Snapshot).public.players.find((player) => player.seat === actor)?.autopilot).toBe('manual')
    // The steady bot passes the auction instead of spending the absent player's money.
    const moved = await waitFor(async () => { const view = await snapshot(cookie, code); return view.room.revision > first.room.revision && view })
    expect(moved.public.phase.currentSeat).not.toBe(actor)
    const audit = await pool.query("SELECT command_id, result->>'kind' AS kind FROM commands WHERE command_id LIKE 'autopilot:%'")
    expect(audit.rows.length).toBeGreaterThan(0)
    expect(audit.rows.every((row) => row.kind === 'accepted')).toBe(true)
    const released = await post(cookie, `/api/rooms/${code}/autopilot`, { enabled: false })
    expect((released.json() as Snapshot).public.players.find((player) => player.seat === actor)?.autopilot).toBeNull()
  })

  it('takes over right after a logout and lets the same nickname reclaim the seat on a new session', async () => {
    const { code, cookies } = await startTable()
    const before = await snapshot(cookies[0]!, code)
    const actor = before.public.phase.currentSeat!
    const nickname = before.public.players.find((player) => player.seat === actor)!.nickname
    expect((await app.inject({ method: 'DELETE', url: '/api/session', headers: { origin, cookie: cookies[actor - 1]! } })).statusCode).toBe(204)
    const watcher = cookies.find((_, index) => index !== actor - 1)!
    const away = await waitFor(async () => { const view = await snapshot(watcher, code); return view.room.revision > before.room.revision && view })
    expect(away.public.players.find((player) => player.seat === actor)?.autopilot).toBe('away')

    const fresh = await login('127.0.0.9')
    const wrong = await post(fresh, '/api/rooms/join', { commandId: 'rejoin-wrong', roomCode: code, nickname: 'Somebody' })
    expect(wrong.statusCode).toBe(409)
    expect(wrong.json()).toEqual({ code: 'SEAT_NOT_CLAIMABLE' })
    const online = before.public.players.find((player) => player.seat !== actor)!.nickname
    expect((await post(fresh, '/api/rooms/join', { commandId: 'rejoin-online', roomCode: code, nickname: online })).json()).toEqual({ code: 'SEAT_NOT_CLAIMABLE' })

    const reclaimed = await post(fresh, '/api/rooms/join', { commandId: 'rejoin', roomCode: code, nickname: nickname.toLowerCase() })
    expect(reclaimed.statusCode).toBe(200)
    expect(reclaimed.json().room.status).toBe('playing')
    const view = await snapshot(fresh, code)
    expect(view.self.seat).toBe(actor)
    expect(view.public.players.find((player) => player.seat === actor)?.autopilot).toBeNull()
  })

  it('steps in after the grace period for a disconnected seat and steps back when it reconnects', async () => {
    const { code, cookies } = await startTable()
    const before = await snapshot(cookies[0]!, code)
    const actor = before.public.phase.currentSeat!
    const cookie = cookies[actor - 1]!
    const socket = new WebSocket(`ws://127.0.0.1:${address}/api/rooms/${code}/subscribe`, { origin, headers: { cookie } })
    await new Promise((resolve) => socket.once('open', resolve))
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect((await snapshot(cookie, code)).room.revision).toBe(before.room.revision)
    socket.close()
    const taken = await waitFor(async () => { const view = await snapshot(cookie, code); return view.public.players.find((player) => player.seat === actor)?.autopilot === 'away' && view })
    expect(taken.room.revision).toBeGreaterThan(before.room.revision)
    const back = new WebSocket(`ws://127.0.0.1:${address}/api/rooms/${code}/subscribe`, { origin, headers: { cookie } })
    await new Promise((resolve) => back.once('open', resolve))
    await waitFor(async () => (await snapshot(cookie, code)).public.players.find((player) => player.seat === actor)?.autopilot === null)
    back.close()
  })

  it('finishes a whole game with every seat on the bot, then returns everyone to the lobby', async () => {
    const { code, cookies } = await startTable()
    for (const cookie of cookies) await post(cookie, `/api/rooms/${code}/autopilot`, { enabled: true })
    const finished = await waitFor(async () => { const view = await snapshot(cookies[0]!, code); return view.room.status === 'finished' && view }, 60_000)
    expect(finished.public.standings).not.toBeNull()
    const left = await app.inject({ method: 'DELETE', url: `/api/rooms/${code}/members/me`, headers: { origin, cookie: cookies[0]! }, payload: { commandId: 'leave', expectedRevision: finished.room.revision } })
    expect(left.statusCode).toBe(200)
    expect(left.json().room).toBeNull()
    expect((await post(cookies[0]!, '/api/rooms', { commandId: 'again', nickname: 'Host' })).statusCode).toBe(200)
    // The others still see the final standings.
    expect((await snapshot(cookies[1]!, code)).public.standings).not.toBeNull()
  }, 70_000)
})

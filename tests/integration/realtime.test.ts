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

function getCookie(response: { headers: Record<string, unknown> }) {
  const raw = response.headers['set-cookie']
  return (Array.isArray(raw) ? raw[0] : raw)!.split(';', 1)[0]!
}
type Message = { type: string; snapshot?: { room: { revision: number }; self: { seat: number }; decision: unknown } }
function inbox(socket: WebSocket) {
  const queued: Message[] = []
  let resolve: ((message: Message) => void) | null = null
  socket.on('message', (data) => { const message = JSON.parse(data.toString()) as Message; if (resolve) { const current = resolve; resolve = null; current(message) } else queued.push(message) })
  return { next: () => queued.shift() ?? new Promise<Message>((accept, reject) => { resolve = accept; setTimeout(() => { if (resolve === accept) { resolve = null; reject(new Error('websocket timeout')) } }, 3_000) }) }
}
async function nextSnapshot(messages: ReturnType<typeof inbox>) {
  for (let index = 0; index < 5; index += 1) { const message = await messages.next(); if (message.type === 'room.snapshot') return message }
  throw new Error('missing room snapshot')
}
async function login(address: string) {
  return getCookie(await app.inject({ method: 'POST', url: '/api/session', remoteAddress: address, headers: { origin }, payload: { token: '23456789' } }))
}
async function post(cookie: string, url: string, payload: object) {
  return app.inject({ method: 'POST', url, headers: { origin, cookie }, payload })
}

beforeEach(async () => {
  await resetTestDatabase(databaseUrl)
  pool = createPool(databaseUrl)
  await runMigrations(pool, migrationsDir)
  await createAccessToken(pool, { id: 'token', digest: digestAccessToken('23456789', 'test-pepper'), label: null })
  app = buildServer({ environment: 'test', host: '127.0.0.1', port: 3000, databaseUrl, authPepper: 'test-pepper', allowedOrigins: [origin], secureCookies: false, sessionTtlMs: 604_800_000 }, { pool })
  await app.listen({ host: '127.0.0.1', port: 0 })
})
afterEach(async () => app.close())

describe('room websocket', () => {
  it('broadcasts recipient-specific snapshots after an accepted bid', async () => {
    const host = await login('127.0.0.1'), one = await login('127.0.0.2'), two = await login('127.0.0.3')
    const created = await post(host, '/api/rooms', { commandId: 'create', nickname: 'Host' })
    const code = created.json().room.code as string
    await post(one, '/api/rooms/join', { commandId: 'join-1', roomCode: code, nickname: 'One' })
    await post(two, '/api/rooms/join', { commandId: 'join-2', roomCode: code, nickname: 'Two' })
    for (const [cookie, revision, commandId] of [[host, 3, 'ready-host'], [one, 4, 'ready-one'], [two, 5, 'ready-two']] as const) await post(cookie, `/api/rooms/${code}/ready`, { commandId, expectedRevision: revision, ready: true })
    const started = await post(host, `/api/rooms/${code}/start`, { protocolVersion: 1, commandId: 'start', expectedRevision: 6 })
    const starter = started.json().public.phase.currentSeat as number
    const cookies = [host, one, two]
    const address = app.server.address() as { port: number }
    const actor = new WebSocket(`ws://127.0.0.1:${address.port}/api/rooms/${code}/subscribe`, { origin, headers: { cookie: cookies[starter - 1]! } })
    const watcher = new WebSocket(`ws://127.0.0.1:${address.port}/api/rooms/${code}/subscribe`, { origin, headers: { cookie: cookies.find((value) => value !== cookies[starter - 1])! } })
    const actorInbox = inbox(actor), watcherInbox = inbox(watcher)
    await Promise.all([new Promise((resolve) => actor.once('open', resolve)), new Promise((resolve) => watcher.once('open', resolve))])
    const actorSnapshot = (await nextSnapshot(actorInbox)).snapshot!
    const watcherSnapshot = (await nextSnapshot(watcherInbox)).snapshot!
    expect(actorSnapshot.decision).not.toBeNull()
    expect(watcherSnapshot.decision).toBeNull()
    await post(cookies[starter - 1]!, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: 'bid', expectedRevision: 7, action: { type: 'bid', amount: 1, mortgageShareIds: [] } })
    const afterActor = await nextSnapshot(actorInbox)
    const afterWatcher = await nextSnapshot(watcherInbox)
    expect(afterActor.type).toBe('room.snapshot')
    expect(afterWatcher.type).toBe('room.snapshot')
    expect(afterActor.snapshot!.room.revision).toBe(8)
    expect(afterWatcher.snapshot!.room.revision).toBe(8)
    actor.close(); watcher.close()
  })
})

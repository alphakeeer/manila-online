// Fan-out benchmark on the manila_test database (reset): 5 players with live sockets play a random game;
// reports command latency and the time until every socket holds the new revision.
import WebSocket from 'ws'
import { chooseAction } from '@manila/protocol'
import { buildServer } from '../../apps/server/src/server.js'
import { createPool } from '../../apps/server/src/persistence/database.js'
import { runMigrations } from '../../apps/server/src/persistence/migrations.js'
import { getTestDatabaseUrl, resetTestDatabase } from '../../apps/server/src/persistence/testDatabase.js'
import { createAccessToken } from '../../apps/server/src/auth/repository.js'
import { digestAccessToken } from '../../apps/server/src/auth/credentials.js'

const databaseUrl = getTestDatabaseUrl()
const origin = 'http://localhost:5173'
await resetTestDatabase(databaseUrl)
const pool = createPool(databaseUrl)
await runMigrations(pool, new URL('../../apps/server/migrations/', import.meta.url).pathname)
await createAccessToken(pool, { id: 'token', digest: digestAccessToken('23456789', 'bench-pepper'), label: null })
const app = buildServer({ environment: 'test', host: '127.0.0.1', port: 0, databaseUrl, authPepper: 'bench-pepper', allowedOrigins: [origin], secureCookies: false, sessionTtlMs: 604_800_000 }, { pool, rateLimits: { loginMax: 1000, sessionWriteMax: 100000 } })
await app.listen({ host: '127.0.0.1', port: 0 })
const port = (app.server.address() as { port: number }).port
const base = `http://127.0.0.1:${port}`
const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';', 1)[0]!
const post = (cookie: string, path: string, body: object) => fetch(base + path, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const cookies: string[] = []
for (let i = 0; i < 5; i++) cookies.push(cookieOf(await fetch(base + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: '23456789' }) })))
const code = (await (await post(cookies[0]!, '/api/rooms', { commandId: 'c', nickname: 'P1' })).json()).room.code
let rev = 0
for (let i = 1; i < 5; i++) rev = (await (await post(cookies[i]!, '/api/rooms/join', { commandId: `j${i}`, roomCode: code, nickname: `P${i + 1}` })).json()).room.revision
for (let i = 0; i < 5; i++) rev = (await (await post(cookies[i]!, `/api/rooms/${code}/ready`, { commandId: `r${i}`, expectedRevision: rev, ready: true })).json()).room.revision
await post(cookies[0]!, `/api/rooms/${code}/start`, { protocolVersion: 1, commandId: 's', expectedRevision: rev })
const latest = new Array<any>(5)
const waiters: Array<{ revision: number; resolve: () => void }> = []
const sockets = cookies.map((cookie, i) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/api/rooms/${code}/subscribe`, { origin, headers: { cookie } }); ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'room.snapshot') { latest[i] = m.snapshot; for (const w of [...waiters]) if (latest.every((s) => s && s.room.revision >= w.revision)) { waiters.splice(waiters.indexOf(w), 1); w.resolve() } } }); return ws })
await new Promise((r) => setTimeout(r, 500))
const postMs: number[] = [], fanMs: number[] = []
let seed = 3; const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
for (let n = 0; n < 400; n++) {
  const actor = latest.findIndex((s) => s?.decision)
  if (actor < 0) { if (latest[0]?.public.standings) break; await new Promise((r) => setTimeout(r, 20)); continue }
  const snap = latest[actor]
  const action = chooseAction(snap, random)!
  const t0 = performance.now()
  const response = await post(cookies[actor]!, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: `cmd-${n}`, expectedRevision: snap.room.revision, action })
  const t1 = performance.now()
  if (!response.ok) { const again = chooseAction(snap, random, true)!; await post(cookies[actor]!, `/api/rooms/${code}/commands`, { protocolVersion: 1, commandId: `cmd-${n}-c`, expectedRevision: snap.room.revision, action: again }); continue }
  const body = await response.json()
  await new Promise<void>((resolve) => { if (latest.every((s) => s && s.room.revision >= body.room.revision)) resolve(); else waiters.push({ revision: body.room.revision, resolve }) })
  postMs.push(t1 - t0); fanMs.push(performance.now() - t0)
}
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!.toFixed(1) }
console.log(JSON.stringify({ commands: postMs.length, finished: Boolean(latest[0]?.public.standings), postP50: q(postMs, .5), postP95: q(postMs, .95), allSocketsP50: q(fanMs, .5), allSocketsP95: q(fanMs, .95) }))
sockets.forEach((s) => s.close()); await app.close(); process.exit(0)

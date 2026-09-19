import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GameRoomSnapshotSchema, type GameCommandRequest, type GameRoomSnapshot } from '@manila/protocol'
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

beforeEach(async () => {
  await resetTestDatabase(testDatabaseUrl)
  pool = createPool(testDatabaseUrl)
  await runMigrations(pool, migrationsDir)
  await createAccessToken(pool, { id: 'token', digest: digestAccessToken(token, 'test-pepper'), label: null })
  app = buildServer(
    { environment: 'test', host: '127.0.0.1', port: 3000, databaseUrl: testDatabaseUrl, authPepper: 'test-pepper', allowedOrigins: [origin], secureCookies: false, sessionTtlMs: 604_800_000 },
    { pool, randomSeed: () => 20260918, pickIndex: () => 0, rateLimits: { sessionWriteMax: 100_000 } },
  )
})
afterEach(async () => app.close())

async function session(index: number) {
  return cookie(await app.inject({ method: 'POST', url: '/api/session', remoteAddress: `127.0.0.${index + 1}`, headers: { origin }, payload: { token } }))
}
async function write(sessionCookie: string, url: string, payload: object) {
  return app.inject({ method: 'POST', url, headers: { origin, cookie: sessionCookie }, payload })
}
async function readSnapshot(sessionCookie: string, code: string): Promise<GameRoomSnapshot | null> {
  const response = await app.inject({ method: 'GET', url: `/api/rooms/${code}/snapshot`, headers: { cookie: sessionCookie } })
  const parsed = GameRoomSnapshotSchema.safeParse(response.json())
  return response.statusCode === 200 && parsed.success ? parsed.data : null
}

function chooseAction(snapshot: GameRoomSnapshot): GameCommandRequest['action'] | null {
  const decision = snapshot.decision
  if (!decision) return null
  switch (decision.kind) {
    case 'auction': {
      if (decision.minimumBid !== 1 || decision.maximumBid < 1) return { type: 'passAuction' }
      if (snapshot.self.pesos >= 1) return { type: 'bid', amount: 1, mortgageShareIds: [] }
      const collateral = decision.availableCollateralShareIds[0]
      return collateral ? { type: 'bid', amount: 1, mortgageShareIds: [collateral] } : { type: 'passAuction' }
    }
    case 'sharePurchase': {
      const option = [...decision.available].sort((left, right) => left.price - right.price)[0]
      if (!option) return { type: 'buyShare', commodity: null, mortgageShareIds: [] }
      const collateralCount = Math.ceil(Math.max(0, option.price - snapshot.self.pesos) / 12)
      const collateral = decision.availableCollateralShareIds.slice(0, collateralCount)
      if (snapshot.self.pesos + collateral.length * 12 < option.price) return { type: 'buyShare', commodity: null, mortgageShareIds: [] }
      return { type: 'buyShare', commodity: option.commodity, mortgageShareIds: collateral }
    }
    case 'cargoSelection':
      return decision.commodities.length >= 3 ? { type: 'selectCargo', commodities: decision.commodities.slice(0, 3) } : null
    case 'launch': {
      const triple = decision.startPositionTriples[0]
      if (!triple || decision.boatIds.length < 3) return null
      return {
        type: 'launchBoats',
        assignments: decision.boatIds.slice(0, 3).map((boatId, index) => ({
          boatId,
          commodity: decision.commodities[index] ?? decision.commodities[0]!,
          lane: decision.lanes[index] ?? 0,
          startPosition: triple[index] ?? 0,
        })),
      }
    }
    case 'placement': {
      const cheapest = [...decision.options].sort((left, right) => left.cost - right.cost)[0]
      if (!cheapest) return { type: 'passPlacement' }
      const needed = Math.max(0, cheapest.cost - snapshot.self.pesos)
      const collateralCount = Math.ceil(needed / 12)
      const collateral = decision.availableCollateralShareIds.slice(0, collateralCount)
      if (snapshot.self.pesos + collateral.length * 12 < cheapest.cost) return { type: 'passPlacement' }
      return { type: 'placeAccomplice', location: cheapest.location as Extract<GameCommandRequest['action'], { type: 'placeAccomplice' }>['location'], mortgageShareIds: collateral, stowaway: false }
    }
    case 'movementOrder': {
      const boatId = decision.remainingBoatIds[0]
      return boatId ? { type: 'moveBoat', boatId } : null
    }
    case 'smallPilot':
    case 'largePilot': {
      const moves = decision.legalMoves.find((candidate) => candidate.length === 0) ?? decision.legalMoves[0]
      return moves ? { type: 'pilotMove', moves } : null
    }
    case 'pirateBoarding': {
      for (const boatId of decision.eligibleBoatIds) {
        const displacedAccompliceId = decision.displaceableByBoat[boatId]?.[0]
        return displacedAccompliceId
          ? { type: 'boardPirate', accompliceId: decision.accompliceId, boatId, displacedAccompliceId }
          : { type: 'boardPirate', accompliceId: decision.accompliceId, boatId }
      }
      return { type: 'boardPirate', accompliceId: decision.accompliceId, boatId: null }
    }
    case 'plunderDestination':
      return { type: 'choosePlunderDestination', boatId: decision.boatId, destination: 'port' }
  }
}

async function playToEnd(sessions: string[], code: string, maxSteps = 3000) {
  for (let step = 0; step < maxSteps; step += 1) {
    let acted = false
    for (const sessionCookie of sessions) {
      const snapshot = await readSnapshot(sessionCookie, code)
      if (!snapshot) continue
      if (snapshot.room.status === 'finished') return snapshot
      const action = chooseAction(snapshot)
      if (!action) continue
      const response = await write(sessionCookie, `/api/rooms/${code}/commands`, {
        protocolVersion: 1,
        commandId: crypto.randomUUID(),
        expectedRevision: snapshot.room.revision,
        action,
      })
      if (response.statusCode === 200) {
        acted = true
        break
      }
      const body = response.json() as { code?: string }
      if (body.code !== 'REVISION_CONFLICT') throw new Error(`command rejected: ${JSON.stringify(body)} for ${JSON.stringify(action)} on ${JSON.stringify({ decision: snapshot.decision, self: snapshot.self, phase: snapshot.public.phase, revision: snapshot.room.revision })}`)
    }
    if (!acted) {
      const snapshots = await Promise.all(sessions.map((sessionCookie) => readSnapshot(sessionCookie, code)))
      if (snapshots.some((snapshot) => snapshot?.room.status === 'finished')) return snapshots.find((snapshot) => snapshot?.room.status === 'finished')!
    }
  }
  throw new Error('playthrough did not finish within the step budget')
}

describe('full online playthrough', () => {
  for (const players of [3, 4, 5]) {
    for (const variant of ['standard', 'strengthened'] as const) {
      it(`${players} players complete a ${variant} game through the authoritative HTTP chain`, async () => {
        const sessions = await Promise.all(Array.from({ length: players }, (_, index) => session(index)))
        const created = await write(sessions[0]!, '/api/rooms', { commandId: 'create', nickname: 'P1', pirateVariant: variant })
        const code = created.json().room.code as string
        for (let index = 1; index < players; index += 1) {
          expect((await write(sessions[index]!, '/api/rooms/join', { commandId: `join-${index}`, roomCode: code, nickname: `P${index + 1}` })).statusCode).toBe(200)
        }
        let revision = players
        for (let index = 0; index < players; index += 1) {
          expect((await write(sessions[index]!, `/api/rooms/${code}/ready`, { commandId: `ready-${index}`, expectedRevision: revision, ready: true })).statusCode).toBe(200)
          revision += 1
        }
        expect((await write(sessions[0]!, `/api/rooms/${code}/start`, { protocolVersion: 1, commandId: 'start', expectedRevision: revision })).statusCode).toBe(200)

        const finished = await playToEnd(sessions, code)
        expect(finished.room.status).toBe('finished')
        expect(finished.public.standings).toHaveLength(players)
        expect(finished.public.standings?.every((standing) => Number.isFinite(standing.wealth))).toBe(true)
        for (const sessionCookie of sessions) {
          const view = await readSnapshot(sessionCookie, code)
          expect(view?.room.status).toBe('finished')
          expect(view?.decision).toBeNull()

          const historyResponse = await app.inject({ method: 'GET', url: `/api/rooms/${code}/history`, headers: { cookie: sessionCookie } })
          expect(historyResponse.statusCode).toBe(200)
          const history = historyResponse.json() as { settlements: Array<{ voyage: number; public: { boats: unknown[]; market: unknown[] }; self: { incomes: unknown[]; payments: unknown[]; pesosDelta: number } | null }> }
          expect(history.settlements.length).toBeGreaterThan(0)
          for (const entry of history.settlements) {
            expect(entry.public.boats).toBeInstanceOf(Array)
            expect(entry.public.market).toBeInstanceOf(Array)
            expect(entry.self).not.toBeNull()
            expect(entry.self?.incomes).toBeInstanceOf(Array)
            expect(entry.self?.payments).toBeInstanceOf(Array)
            expect(JSON.stringify(entry)).not.toContain('shareId')
          }
          expect(historyResponse.body).not.toContain('seed')
        }
      }, 180_000)
    }
  }
})

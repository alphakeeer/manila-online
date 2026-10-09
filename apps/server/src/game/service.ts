import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { createGame, getDecision, getStandings, transition, validateState, type GameAction, type GameEvent, type GameState, type SettlementIncome, type SettlementPayment } from '@manila/game'
import { chooseAction, GameRoomSnapshotSchema, SettlementHistorySchema, PROTOCOL_VERSION, type GameCommandRequest, type GameRoomSnapshot, type PirateVariant, type SeatAutopilot, type SettlementHistory } from '@manila/protocol'
import type { Pool, PoolClient } from 'pg'
import { withTransaction } from '../persistence/database.js'

const RULES_VERSION = 1

type RoomRow = { id: string; code: string; status: 'lobby' | 'playing' | 'finished' | 'isolated' | 'closed'; pirate_variant: PirateVariant; revision: number }
type SessionRow = { id: string; active_room_id: string | null; expires_at: Date; revoked_at: Date | null; token_revoked_at: Date | null }
type MemberRow = { session_id: string; player_id: string; nickname: string; seat: number; is_ready: boolean; autopilot: SeatAutopilot | null }
type GameRow = { snapshot: GameState; seed: string; state_version: number; rules_version: number; protocol_version: number }
type StoredCommand = { request_digest: string; result: GameCommandResult }
export type GameErrorCode = 'AUTH_REQUIRED' | 'TOKEN_REVOKED' | 'NOT_MEMBER' | 'NOT_HOST' | 'ROOM_NOT_FOUND' | 'ROOM_CLOSED' | 'ROOM_ISOLATED' | 'START_NOT_READY' | 'GAME_NOT_FOUND' | 'REVISION_CONFLICT' | 'COMMAND_ID_REUSED' | 'RULE_REJECTED' | 'ACTION_NOT_AVAILABLE'
export type GameCommandResult = { kind: 'accepted'; snapshot: GameRoomSnapshot } | { kind: 'rejected'; code: GameErrorCode }
/** Who must act next and whether the server may play for them. */
export type AutopilotSeatState = { revision: number; actor: { seat: number; autopilot: SeatAutopilot | null; sessionValid: boolean } | null }
export type AutopilotActResult = { kind: 'accepted' } | { kind: 'skipped' } | { kind: 'stuck' }
export type GameHistoryResult = { kind: 'accepted'; history: SettlementHistory } | { kind: 'rejected'; code: GameErrorCode }

const reject = (code: GameErrorCode): GameCommandResult => ({ kind: 'rejected', code })

function digest(value: unknown, pepper: string) {
  return createHmac('sha256', pepper).update('manila/game-command/v1\0').update(JSON.stringify(value)).digest('hex')
}

async function lockSession(client: PoolClient, sessionId: string) {
  const result = await client.query<SessionRow>(`SELECT sessions.id, sessions.active_room_id, sessions.expires_at, sessions.revoked_at, access_tokens.revoked_at AS token_revoked_at FROM sessions JOIN access_tokens ON access_tokens.id = sessions.token_id WHERE sessions.id = $1 FOR UPDATE OF sessions`, [sessionId])
  return result.rows[0] ?? null
}

async function lockRoom(client: PoolClient, roomId: string) {
  const result = await client.query<RoomRow>('SELECT id, code, status, pirate_variant, revision FROM rooms WHERE id = $1 FOR UPDATE', [roomId])
  return result.rows[0] ?? null
}

async function members(client: PoolClient, roomId: string) {
  const result = await client.query<MemberRow>('SELECT session_id, player_id, nickname, seat, is_ready, autopilot FROM room_members WHERE room_id = $1 ORDER BY seat', [roomId])
  return result.rows
}

async function replay(client: PoolClient, roomId: string, sessionId: string, commandId: string, requestDigest: string) {
  const result = await client.query<StoredCommand>('SELECT request_digest, result FROM commands WHERE scope_key = $1 AND session_id = $2 AND command_id = $3', [`room:${roomId}`, sessionId, commandId])
  const row = result.rows[0]
  if (!row) return null
  return row.request_digest === requestDigest ? row.result : reject('COMMAND_ID_REUSED')
}

async function saveCommand(client: PoolClient, roomId: string, sessionId: string, commandId: string, requestDigest: string, result: GameCommandResult, revision: number | null) {
  await client.query('INSERT INTO commands (room_id, session_id, scope_key, command_id, request_digest, accepted, result, accepted_revision) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [roomId, sessionId, `room:${roomId}`, commandId, requestDigest, result.kind === 'accepted', JSON.stringify(result), revision])
}

function sessionError(session: SessionRow | null, now: number): GameErrorCode | null {
  if (!session || session.revoked_at || session.expires_at.getTime() <= now) return 'AUTH_REQUIRED'
  if (session.token_revoked_at) return 'TOKEN_REVOKED'
  return null
}

function phaseSeat(state: GameState, memberByPlayer: Map<string, MemberRow>) {
  const phase = state.phase
  const playerId = 'currentPlayerId' in phase ? phase.currentPlayerId : 'playerId' in phase ? phase.playerId : null
  return playerId ? memberByPlayer.get(playerId)?.seat ?? null : null
}

function publicAccompliceId(state: GameState, accompliceId: string) {
  const index = state.accomplices.findIndex((candidate) => candidate.id === accompliceId)
  if (index < 0) throw new Error('未知同伙')
  return `accomplice-${index + 1}`
}

function internalAccompliceId(state: GameState, publicId: string) {
  const matched = /^accomplice-([1-9]\d*)$/.exec(publicId)
  const index = matched ? Number(matched[1]) - 1 : -1
  return state.accomplices[index]?.id ?? publicId
}

function project(room: RoomRow, state: GameState, roomMembers: MemberRow[], viewer: MemberRow): GameRoomSnapshot {
  const memberByPlayer = new Map(roomMembers.map((member) => [member.player_id, member]))
  const player = state.players.find((candidate) => candidate.id === viewer.player_id)
  if (!player) throw new Error('成员没有对应游戏玩家')
  const highestBid = state.phase.kind === 'auction' && state.phase.highestBid
    ? { amount: state.phase.highestBid.amount, bidderSeat: memberByPlayer.get(state.phase.highestBid.playerId)?.seat ?? 0 }
    : null
  const decision = getDecision(state)
  const projectedDecision = decision && 'playerId' in decision && decision.playerId === viewer.player_id
    ? decision.kind === 'auction'
      ? { kind: 'auction', minimumBid: decision.minimumBid, maximumBid: decision.maximumBid, availableCollateralShareIds: [...decision.availableCollateralShareIds] }
      : decision.kind === 'sharePurchase'
        ? { kind: 'sharePurchase', available: decision.available.map(({ commodity, price }) => ({ commodity, price })), availableCollateralShareIds: [...decision.availableCollateralShareIds] }
        : decision.kind === 'cargoSelection'
          ? { kind: 'cargoSelection', commodities: [...decision.commodities] }
          : decision.kind === 'launch'
            ? { kind: 'launch', boatIds: [...decision.boatIds], commodities: [...decision.commodities], lanes: [...decision.lanes], startPositionTriples: decision.startPositionTriples.map((triple) => [...triple]) }
            : decision.kind === 'placement'
              ? { kind: 'placement', placementRound: decision.placementRound, options: decision.options.map((option) => ({ location: option.location, cost: option.cost })), canStowaway: decision.canStowaway, canPass: decision.canPass, availableCollateralShareIds: [...decision.availableCollateralShareIds] }
              : decision.kind === 'movementOrder'
                ? { kind: 'movementOrder', movementRound: decision.movementRound, dice: decision.dice, remainingBoatIds: [...decision.remainingBoatIds] }
                : decision.kind === 'smallPilot' || decision.kind === 'largePilot'
                  ? { kind: decision.kind, movableBoatIds: [...decision.movableBoatIds], legalMoves: decision.legalMoves.map((moves) => moves.map((move) => ({ ...move }))) }
                  : decision.kind === 'pirateBoarding'
                    ? { kind: 'pirateBoarding', accompliceId: publicAccompliceId(state, decision.accompliceId), eligibleBoatIds: [...decision.eligibleBoatIds], displaceableByBoat: Object.fromEntries(Object.entries(decision.displaceableByBoat).map(([boatId, ids]) => [boatId, ids.map((id) => publicAccompliceId(state, id))])), canStay: decision.canStay }
                    : { kind: 'plunderDestination', boatId: decision.boatId, destinations: [...decision.destinations] }
    : null
  return GameRoomSnapshotSchema.parse({
    room: { code: room.code, revision: room.revision, pirateVariant: room.pirate_variant, status: room.status === 'finished' ? 'finished' : room.status === 'closed' ? 'closed' : 'playing', readOnly: room.status !== 'playing' },
    public: {
      voyage: state.voyage,
      phase: { kind: state.phase.kind, currentSeat: phaseSeat(state, memberByPlayer), dice: state.phase.kind === 'movementOrder' ? state.phase.dice : null },
      harborMasterSeat: state.harborMasterId ? memberByPlayer.get(state.harborMasterId)?.seat ?? null : null,
      highestBid,
      market: state.market,
      boats: state.boats.map((boat) => ({ id: boat.id, commodity: boat.commodity, lane: boat.lane, position: boat.position, status: boat.status, berth: boat.berth, plundered: boat.plundered })),
      accomplices: state.accomplices.map((accomplice) => ({ id: publicAccompliceId(state, accomplice.id), seat: memberByPlayer.get(accomplice.playerId)?.seat ?? 0, location: accomplice.location })),
      players: roomMembers.map((member) => ({ seat: member.seat, nickname: member.nickname, autopilot: member.autopilot })),
      shareSupply: Object.fromEntries(['nutmeg', 'silk', 'jade', 'ginseng'].map((commodity) => [commodity, state.shareSupply.filter((share) => share.commodity === commodity).length])),
      standings: state.phase.kind === 'gameOver' ? getStandings(state).map((standing) => ({ seat: memberByPlayer.get(standing.playerId)?.seat ?? 0, nickname: standing.name, wealth: standing.wealth, winner: standing.winner })) : null,
    },
    self: { seat: viewer.seat, pesos: player.pesos, shares: player.shares.map((share) => ({ id: share.id, commodity: share.commodity, mortgaged: share.mortgaged })) },
    decision: projectedDecision,
  })
}

function toGameAction(state: GameState, playerId: string, action: GameCommandRequest['action']): GameAction {
  switch (action.type) {
    case 'bid': return { ...action, playerId }
    case 'passAuction': return { type: 'passAuction', playerId }
    case 'buyShare': {
      const shareId = action.commodity === null ? null : state.shareSupply.find((share) => share.commodity === action.commodity)?.id
      return { type: 'buyShare', playerId, shareId: shareId ?? null, mortgageShareIds: action.mortgageShareIds }
    }
    case 'selectCargo': return { ...action, playerId }
    case 'launchBoats': return { ...action, playerId }
    case 'placeAccomplice': return { ...action, playerId } as GameAction
    case 'passPlacement': return { type: 'passPlacement', playerId }
    case 'moveBoat': return { ...action, playerId }
    case 'pilotMove': return { ...action, playerId }
    case 'boardPirate': {
      const accompliceId = internalAccompliceId(state, action.accompliceId)
      const displacedAccompliceId = action.displacedAccompliceId === undefined ? undefined : internalAccompliceId(state, action.displacedAccompliceId)
      return displacedAccompliceId === undefined
        ? { type: 'boardPirate', playerId, accompliceId, boatId: action.boatId }
        : { type: 'boardPirate', playerId, accompliceId, boatId: action.boatId, displacedAccompliceId }
    }
    case 'choosePlunderDestination': return { ...action, playerId }
    case 'mortgageShare': return { ...action, playerId }
    case 'redeemShare': return { ...action, playerId }
  }
}

function publicEvents(events: GameEvent[], roomMembers: MemberRow[]): Array<{ eventType: string; payload: Record<string, unknown>; privatePayload?: Record<string, unknown> }> {
  const seatFor = new Map(roomMembers.map((member) => [member.player_id, member.seat]))
  const publicEvents: Array<{ eventType: string; payload: Record<string, unknown>; privatePayload?: Record<string, unknown> }> = []
  for (const event of events) {
    if (event.type === 'bidPlaced') publicEvents.push({ eventType: 'auction.bidPlaced', payload: { amount: event.amount, bidderSeat: seatFor.get(String(event.playerId)) } })
    if (event.type === 'auctionPassed') publicEvents.push({ eventType: 'auction.passed', payload: { seat: seatFor.get(String(event.playerId)) } })
    if (event.type === 'auctionWon') publicEvents.push({ eventType: 'auction.won', payload: { amount: event.amount, harborMasterSeat: seatFor.get(String(event.playerId)) } })
    if (event.type === 'voyageSettled') {
      const deltas = Array.isArray(event.playerDeltas) ? event.playerDeltas as Array<{ playerId: string; pesosDelta: number }> : []
      const incomes = Array.isArray(event.incomes) ? event.incomes as SettlementIncome[] : []
      const payments = Array.isArray(event.payments) ? event.payments as SettlementPayment[] : []
      const privateByPlayer = new Map<string, { incomes: Array<Omit<SettlementIncome, 'playerId'>>; payments: Array<Omit<SettlementPayment, 'playerId'>>; pesosDelta: number }>()
      for (const delta of deltas) privateByPlayer.set(delta.playerId, { incomes: [], payments: [], pesosDelta: delta.pesosDelta })
      for (const income of incomes) {
        const { playerId, ...rest } = income
        privateByPlayer.get(playerId)?.incomes.push(rest)
      }
      for (const payment of payments) {
        const { playerId, ...rest } = payment
        privateByPlayer.get(playerId)?.payments.push(rest)
      }
      publicEvents.push({ eventType: 'voyage.settled', payload: { voyage: event.voyage, boats: event.boats, market: event.market }, privatePayload: Object.fromEntries(privateByPlayer) })
    }
  }
  return publicEvents
}

export class GameService {
  constructor(
    private readonly pool: Pool,
    private readonly pepper: string,
    private readonly now: () => number = Date.now,
    private readonly onIsolate: (roomCode: string) => void = () => undefined,
    private readonly randomSeed: () => number = () => randomBytes(4).readUInt32BE(0),
    private readonly pickIndex: (count: number) => number = (count) => randomInt(count),
    private readonly random: () => number = Math.random,
  ) {}

  async latest(sessionId: string, roomCode: string): Promise<GameCommandResult> {
    return withTransaction<GameCommandResult>(this.pool, async (client) => {
      const session = await lockSession(client, sessionId)
      const authError = sessionError(session, this.now())
      if (authError || !session?.active_room_id) return reject(authError ?? 'NOT_MEMBER')
      const room = await lockRoom(client, session.active_room_id)
      if (!room || room.code !== roomCode) return reject('ROOM_NOT_FOUND')
      if (room.status === 'isolated') return reject('ROOM_ISOLATED')
      if (room.status !== 'playing' && room.status !== 'finished' && room.status !== 'closed') return reject('ROOM_CLOSED')
      const roomMembers = await members(client, room.id)
      const viewer = roomMembers.find((member) => member.session_id === sessionId)
      if (!viewer) return reject('NOT_MEMBER')
      const result = await client.query<GameRow>('SELECT snapshot, seed, state_version, rules_version, protocol_version FROM games WHERE room_id = $1', [room.id])
      const game = result.rows[0]
      if (!game) return reject('GAME_NOT_FOUND')
      if (this.invalidGame(game)) {
        await this.isolate(client, room)
        return reject('ROOM_ISOLATED')
      }
      return { kind: 'accepted', snapshot: project(room, game.snapshot, roomMembers, viewer) }
    })
  }

  /**
   * Broadcast path: every subscriber's view from one consistent read (room + game + members in a
   * single statement) instead of one locking transaction per subscriber. Same authorization rules
   * as latest(); an unreadable snapshot falls back to latest() so isolation still happens.
   */
  async snapshotsFor(roomCode: string, sessionIds: readonly string[]): Promise<Map<string, GameCommandResult>> {
    const results = new Map<string, GameCommandResult>()
    if (sessionIds.length === 0) return results
    const found = await this.pool.query<RoomRow & GameRow & { members: MemberRow[] | null }>(
      `SELECT rooms.id, rooms.code, rooms.status, rooms.pirate_variant, rooms.revision,
              games.snapshot, games.seed, games.state_version, games.rules_version, games.protocol_version,
              (SELECT json_agg(member ORDER BY member.seat) FROM (
                 SELECT session_id, player_id, nickname, seat, is_ready, autopilot FROM room_members WHERE room_id = rooms.id
               ) member) AS members
         FROM rooms JOIN games ON games.room_id = rooms.id
        WHERE rooms.code = $1`,
      [roomCode],
    )
    const row = found.rows[0]
    if (!row || row.status === 'isolated' || this.invalidGame(row)) {
      for (const sessionId of sessionIds) results.set(sessionId, await this.latest(sessionId, roomCode))
      return results
    }
    const sessions = await this.pool.query<SessionRow>(
      `SELECT sessions.id, sessions.active_room_id, sessions.expires_at, sessions.revoked_at, access_tokens.revoked_at AS token_revoked_at
         FROM sessions JOIN access_tokens ON access_tokens.id = sessions.token_id WHERE sessions.id = ANY($1::text[])`,
      [[...sessionIds]],
    )
    const sessionById = new Map(sessions.rows.map((session) => [session.id, session]))
    const room: RoomRow = { id: row.id, code: row.code, status: row.status, pirate_variant: row.pirate_variant, revision: row.revision }
    const roomMembers = row.members ?? []
    for (const sessionId of sessionIds) {
      const session = sessionById.get(sessionId) ?? null
      const authError = sessionError(session, this.now())
      if (authError) { results.set(sessionId, reject(authError)); continue }
      if (session?.active_room_id !== room.id) { results.set(sessionId, reject('NOT_MEMBER')); continue }
      if (room.status !== 'playing' && room.status !== 'finished' && room.status !== 'closed') { results.set(sessionId, reject('ROOM_CLOSED')); continue }
      const viewer = roomMembers.find((member) => member.session_id === sessionId)
      results.set(sessionId, viewer ? { kind: 'accepted', snapshot: project(room, row.snapshot, roomMembers, viewer) } : reject('NOT_MEMBER'))
    }
    return results
  }

  async history(sessionId: string, roomCode: string): Promise<GameHistoryResult> {
    return withTransaction<GameHistoryResult>(this.pool, async (client) => {
      const rejectHistory = (code: GameErrorCode): GameHistoryResult => ({ kind: 'rejected', code })
      const session = await lockSession(client, sessionId)
      const authError = sessionError(session, this.now())
      if (authError || !session?.active_room_id) return rejectHistory(authError ?? 'NOT_MEMBER')
      const room = await lockRoom(client, session.active_room_id)
      if (!room || room.code !== roomCode) return rejectHistory('ROOM_NOT_FOUND')
      const roomMembers = await members(client, room.id)
      const viewer = roomMembers.find((member) => member.session_id === sessionId)
      if (!viewer) return rejectHistory('NOT_MEMBER')
      const result = await client.query<{ public_payload: unknown; private_payload: Record<string, { incomes: unknown[]; payments: unknown[]; pesosDelta: number }> | null }>('SELECT public_payload, private_payload FROM events WHERE room_id = $1 AND event_type = $2 ORDER BY revision', [room.id, 'voyage.settled'])
      return { kind: 'accepted', history: SettlementHistorySchema.parse({ settlements: result.rows.map((event) => ({ voyage: Number((event.public_payload as { voyage?: number }).voyage ?? 0), public: event.public_payload, self: event.private_payload?.[viewer.player_id] ?? null })) }) }
    })
  }

  async start(sessionId: string, roomCode: string, input: { commandId: string; expectedRevision: number }) {
    return withTransaction(this.pool, async (client) => {
      const requestDigest = digest(input, this.pepper)
      const session = await lockSession(client, sessionId)
      const authError = sessionError(session, this.now())
      if (authError || !session?.active_room_id) return reject(authError ?? 'NOT_MEMBER')
      const room = await lockRoom(client, session.active_room_id)
      if (!room || room.code !== roomCode) return reject('ROOM_NOT_FOUND')
      const replayed = await replay(client, room.id, sessionId, input.commandId, requestDigest)
      if (replayed) return replayed
      const roomMembers = await members(client, room.id)
      const viewer = roomMembers.find((member) => member.session_id === sessionId)
      if (!viewer) return reject('NOT_MEMBER')
      if (viewer.seat !== roomMembers[0]?.seat) return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'NOT_HOST')
      if (room.status !== 'lobby') return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'ROOM_CLOSED')
      if (room.revision !== input.expectedRevision) return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'REVISION_CONFLICT')
      if (roomMembers.length < 3 || roomMembers.length > 5 || roomMembers.some((member) => !member.is_ready)) return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'START_NOT_READY')
      const seed = this.randomSeed()
      const starter = roomMembers[this.pickIndex(roomMembers.length)]
      if (!starter) throw new Error('没有可抽取的首位出价者')
      const created = createGame({ players: roomMembers.map((member) => ({ id: member.player_id, name: member.nickname })), startingPlayerId: starter.player_id, seed, pirateVariant: room.pirate_variant })
      if (!created.ok || validateState(created.value).length > 0) throw new Error('创建游戏状态失败')
      room.status = 'playing'
      room.revision += 1
      await client.query('UPDATE rooms SET status = $1, revision = $2 WHERE id = $3', [room.status, room.revision, room.id])
      await client.query('INSERT INTO games (room_id, snapshot, seed, state_version, rules_version, protocol_version) VALUES ($1, $2, $3, $4, $5, $6)', [room.id, JSON.stringify(created.value), seed, created.value.version, RULES_VERSION, PROTOCOL_VERSION])
      await client.query('INSERT INTO events (room_id, revision, event_type, public_payload) VALUES ($1, $2, $3, $4)', [room.id, room.revision, 'game.started', JSON.stringify({ startingSeat: starter.seat })])
      const accepted: GameCommandResult = { kind: 'accepted', snapshot: project(room, created.value, roomMembers, viewer) }
      await saveCommand(client, room.id, sessionId, input.commandId, requestDigest, accepted, room.revision)
      return accepted
    })
  }

  async command(sessionId: string, roomCode: string, input: GameCommandRequest) {
    return withTransaction(this.pool, async (client) => {
      const requestDigest = digest(input, this.pepper)
      const session = await lockSession(client, sessionId)
      const authError = sessionError(session, this.now())
      if (authError || !session?.active_room_id) return reject(authError ?? 'NOT_MEMBER')
      const room = await lockRoom(client, session.active_room_id)
      if (!room || room.code !== roomCode) return reject('ROOM_NOT_FOUND')
      const replayed = await replay(client, room.id, sessionId, input.commandId, requestDigest)
      if (replayed) return replayed
      const roomMembers = await members(client, room.id)
      const viewer = roomMembers.find((member) => member.session_id === sessionId)
      if (!viewer) return reject('NOT_MEMBER')
      if (room.status === 'isolated') return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'ROOM_ISOLATED')
      if (room.status !== 'playing') return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'ROOM_CLOSED')
      if (room.revision !== input.expectedRevision) return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'REVISION_CONFLICT')
      const row = await client.query<GameRow>('SELECT snapshot, seed, state_version, rules_version, protocol_version FROM games WHERE room_id = $1 FOR UPDATE', [room.id])
      const game = row.rows[0]
      if (!game) return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'GAME_NOT_FOUND')
      if (this.invalidGame(game)) {
        await this.isolate(client, room)
        return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'ROOM_ISOLATED')
      }
      const next = await this.apply(client, room, game.snapshot, roomMembers, viewer, input.action)
      if (!next) return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'RULE_REJECTED')
      // Acting in person takes the seat back from the bot.
      if (viewer.autopilot) await this.writeAutopilot(client, room.id, viewer, null)
      const accepted: GameCommandResult = { kind: 'accepted', snapshot: project(room, next, roomMembers, viewer) }
      await saveCommand(client, room.id, sessionId, input.commandId, requestDigest, accepted, room.revision)
      return accepted
    })
  }

  /** Lets a member hand their seat to the steady bot ('manual') or take it back. Not a game rule action. */
  async setAutopilot(sessionId: string, roomCode: string, enabled: boolean): Promise<GameCommandResult> {
    return withTransaction<GameCommandResult>(this.pool, async (client) => {
      const session = await lockSession(client, sessionId)
      const authError = sessionError(session, this.now())
      if (authError || !session?.active_room_id) return reject(authError ?? 'NOT_MEMBER')
      const room = await lockRoom(client, session.active_room_id)
      if (!room || room.code !== roomCode) return reject('ROOM_NOT_FOUND')
      if (room.status !== 'playing') return reject('ROOM_CLOSED')
      const roomMembers = await members(client, room.id)
      const viewer = roomMembers.find((member) => member.session_id === sessionId)
      if (!viewer) return reject('NOT_MEMBER')
      const game = await client.query<GameRow>('SELECT snapshot, seed, state_version, rules_version, protocol_version FROM games WHERE room_id = $1', [room.id])
      if (!game.rows[0]) return reject('GAME_NOT_FOUND')
      await this.writeAutopilot(client, room.id, viewer, enabled ? 'manual' : null)
      return { kind: 'accepted', snapshot: project(room, game.rows[0].snapshot, roomMembers, viewer) }
    })
  }

  /** Called when a member reconnects: an automatic 'away' takeover ends, a requested 'manual' one stays. */
  async clearAway(sessionId: string, roomCode: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE room_members SET autopilot = NULL
        FROM rooms WHERE rooms.id = room_members.room_id AND rooms.code = $1 AND rooms.status = 'playing'
         AND room_members.session_id = $2 AND room_members.autopilot = 'away'`,
      [roomCode, sessionId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async playingRoomCodes(): Promise<string[]> {
    const result = await this.pool.query<{ code: string }>("SELECT code FROM rooms WHERE status = 'playing'")
    return result.rows.map((row) => row.code)
  }

  /** Read-only: the seat that must decide next, its takeover flag and whether its session still works. */
  async autopilotState(roomCode: string): Promise<AutopilotSeatState | null> {
    const room = await this.pool.query<RoomRow>('SELECT id, code, status, pirate_variant, revision FROM rooms WHERE code = $1', [roomCode])
    const current = room.rows[0]
    if (!current || current.status !== 'playing') return null
    const game = await this.pool.query<{ snapshot: GameState }>('SELECT snapshot FROM games WHERE room_id = $1', [current.id])
    const state = game.rows[0]?.snapshot
    if (!state) return null
    const decision = getDecision(state)
    const playerId = decision && 'playerId' in decision ? decision.playerId : null
    if (!playerId) return { revision: current.revision, actor: null }
    const actor = await this.pool.query<MemberRow & { session_valid: boolean }>(
      `SELECT room_members.seat, room_members.autopilot,
              (sessions.revoked_at IS NULL AND sessions.expires_at > to_timestamp($3 / 1000.0) AND access_tokens.revoked_at IS NULL) AS session_valid
         FROM room_members JOIN sessions ON sessions.id = room_members.session_id JOIN access_tokens ON access_tokens.id = sessions.token_id
        WHERE room_members.room_id = $1 AND room_members.player_id = $2`,
      [current.id, playerId, this.now()],
    )
    const row = actor.rows[0]
    return { revision: current.revision, actor: row ? { seat: row.seat, autopilot: row.autopilot, sessionValid: row.session_valid } : null }
  }

  /**
   * Plays exactly one decision for the seat that must act, through the same transition,
   * validation and persistence path as a human command. The caller decides the seat is away;
   * the revision guard makes a stale timer a no-op.
   */
  async autopilotAct(roomCode: string, expectedRevision: number): Promise<AutopilotActResult> {
    // Respect the global lock order (session → room): find the acting seat's session first, unlocked,
    // then lock it before the room and re-validate everything under the locks.
    const actorSession = await this.actingSession(roomCode, expectedRevision)
    if (!actorSession) return { kind: 'skipped' }
    return withTransaction<AutopilotActResult>(this.pool, async (client) => {
      await client.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [actorSession])
      const found = await client.query<RoomRow>('SELECT id, code, status, pirate_variant, revision FROM rooms WHERE code = $1 FOR UPDATE', [roomCode])
      const room = found.rows[0]
      if (!room || room.status !== 'playing' || room.revision !== expectedRevision) return { kind: 'skipped' }
      const row = await client.query<GameRow>('SELECT snapshot, seed, state_version, rules_version, protocol_version FROM games WHERE room_id = $1 FOR UPDATE', [room.id])
      const game = row.rows[0]
      if (!game || this.invalidGame(game)) return { kind: 'skipped' }
      const decision = getDecision(game.snapshot)
      const playerId = decision && 'playerId' in decision ? decision.playerId : null
      const roomMembers = await members(client, room.id)
      const actor = roomMembers.find((member) => member.player_id === playerId)
      if (!actor || actor.session_id !== actorSession) return { kind: 'skipped' }
      if (!actor.autopilot) await this.writeAutopilot(client, room.id, actor, 'away')
      const view = project(room, game.snapshot, roomMembers, actor)
      for (const cautious of [false, true]) {
        const action = chooseAction(view, this.random, cautious, 'steady')
        if (!action) break
        const next = await this.apply(client, room, game.snapshot, roomMembers, actor, action)
        if (!next) continue
        const commandId = `autopilot:${randomUUID()}`
        await saveCommand(client, room.id, actor.session_id, commandId, digest({ commandId, action }, this.pepper), { kind: 'accepted', snapshot: project(room, next, roomMembers, actor) }, room.revision)
        return { kind: 'accepted' }
      }
      return { kind: 'stuck' }
    })
  }

  /** Unlocked read of the session behind the seat that must decide at `revision` (engine-derived, like projections). */
  private async actingSession(roomCode: string, revision: number): Promise<string | null> {
    const found = await this.pool.query<{ id: string; snapshot: GameState }>(
      'SELECT rooms.id, games.snapshot FROM rooms JOIN games ON games.room_id = rooms.id WHERE rooms.code = $1 AND rooms.revision = $2', [roomCode, revision])
    const row = found.rows[0]
    if (!row) return null
    const decision = getDecision(row.snapshot)
    const playerId = decision && 'playerId' in decision ? decision.playerId : null
    if (!playerId) return null
    const member = await this.pool.query<{ session_id: string }>('SELECT session_id FROM room_members WHERE room_id = $1 AND player_id = $2', [row.id, playerId])
    return member.rows[0]?.session_id ?? null
  }

  /** Runs one engine transition and persists state, revision and events. Returns null on a rule rejection. */
  private async apply(client: PoolClient, room: RoomRow, state: GameState, roomMembers: MemberRow[], actor: MemberRow, input: GameCommandRequest['action']): Promise<GameState | null> {
    const action = toGameAction(state, actor.player_id, input)
    const transitioned = transition(structuredClone(state), action)
    if (!transitioned.ok) return null
    if (validateState(transitioned.value.state).length > 0) throw new Error('迁移产生非法游戏状态')
    if (transitioned.value.state.phase.kind === 'gameOver') room.status = 'finished'
    room.revision += 1
    await client.query('UPDATE rooms SET status = $1, revision = $2 WHERE id = $3', [room.status, room.revision, room.id])
    await client.query('UPDATE games SET snapshot = $1, updated_at = now() WHERE room_id = $2', [JSON.stringify(transitioned.value.state), room.id])
    for (const event of publicEvents(transitioned.value.events, roomMembers)) await client.query('INSERT INTO events (room_id, revision, event_type, public_payload, private_payload) VALUES ($1, $2, $3, $4, $5)', [room.id, room.revision, event.eventType, JSON.stringify(event.payload), event.privatePayload === undefined ? null : JSON.stringify(event.privatePayload)])
    return transitioned.value.state
  }

  private async writeAutopilot(client: PoolClient, roomId: string, member: MemberRow, value: SeatAutopilot | null) {
    await client.query('UPDATE room_members SET autopilot = $1 WHERE room_id = $2 AND session_id = $3', [value, roomId, member.session_id])
    member.autopilot = value
  }

  private async recordReject(client: PoolClient, room: RoomRow, sessionId: string, commandId: string, requestDigest: string, code: GameErrorCode) {
    const result = reject(code)
    await saveCommand(client, room.id, sessionId, commandId, requestDigest, result, null)
    return result
  }

  private invalidGame(game: GameRow) {
    return game.state_version !== 1 || game.rules_version !== RULES_VERSION || game.protocol_version !== PROTOCOL_VERSION || validateState(game.snapshot).length > 0
  }

  private async isolate(client: PoolClient, room: RoomRow) {
    if (room.status === 'isolated') return
    room.status = 'isolated'
    await client.query('UPDATE rooms SET status = $1, isolation_reason = $2 WHERE id = $3', ['isolated', 'snapshot validation failed', room.id])
    this.onIsolate(room.code)
  }
}

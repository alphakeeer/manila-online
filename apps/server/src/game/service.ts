import { createHmac, randomBytes, randomInt } from 'node:crypto'
import { createGame, getDecision, getStandings, transition, validateState, type GameAction, type GameEvent, type GameState } from '@manila/game'
import { GameRoomSnapshotSchema, SettlementHistorySchema, PROTOCOL_VERSION, type GameCommandRequest, type GameRoomSnapshot, type PirateVariant, type SettlementHistory } from '@manila/protocol'
import type { Pool, PoolClient } from 'pg'
import { withTransaction } from '../persistence/database.js'

const RULES_VERSION = 1

type RoomRow = { id: string; code: string; status: 'lobby' | 'playing' | 'finished' | 'isolated' | 'closed'; pirate_variant: PirateVariant; revision: number }
type SessionRow = { id: string; active_room_id: string | null; expires_at: Date; revoked_at: Date | null; token_revoked_at: Date | null }
type MemberRow = { session_id: string; player_id: string; nickname: string; seat: number; is_ready: boolean }
type GameRow = { snapshot: GameState; seed: string; state_version: number; rules_version: number; protocol_version: number }
type StoredCommand = { request_digest: string; result: GameCommandResult }
export type GameErrorCode = 'AUTH_REQUIRED' | 'TOKEN_REVOKED' | 'NOT_MEMBER' | 'NOT_HOST' | 'ROOM_NOT_FOUND' | 'ROOM_CLOSED' | 'ROOM_ISOLATED' | 'START_NOT_READY' | 'GAME_NOT_FOUND' | 'REVISION_CONFLICT' | 'COMMAND_ID_REUSED' | 'RULE_REJECTED' | 'ACTION_NOT_AVAILABLE'
export type GameCommandResult = { kind: 'accepted'; snapshot: GameRoomSnapshot } | { kind: 'rejected'; code: GameErrorCode }
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
  const result = await client.query<MemberRow>('SELECT session_id, player_id, nickname, seat, is_ready FROM room_members WHERE room_id = $1 ORDER BY seat', [roomId])
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
    room: { code: room.code, revision: room.revision, pirateVariant: room.pirate_variant, status: room.status === 'finished' ? 'finished' : 'playing' },
    public: {
      voyage: state.voyage,
      phase: { kind: state.phase.kind, currentSeat: phaseSeat(state, memberByPlayer), dice: state.phase.kind === 'movementOrder' ? state.phase.dice : null },
      harborMasterSeat: state.harborMasterId ? memberByPlayer.get(state.harborMasterId)?.seat ?? null : null,
      highestBid,
      market: state.market,
      boats: state.boats.map((boat) => ({ id: boat.id, commodity: boat.commodity, lane: boat.lane, position: boat.position, status: boat.status, berth: boat.berth, plundered: boat.plundered })),
      accomplices: state.accomplices.map((accomplice) => ({ id: publicAccompliceId(state, accomplice.id), seat: memberByPlayer.get(accomplice.playerId)?.seat ?? 0, location: accomplice.location })),
      players: roomMembers.map((member) => ({ seat: member.seat, nickname: member.nickname })),
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
      publicEvents.push({ eventType: 'voyage.settled', payload: { voyage: event.voyage, boats: event.boats, market: event.market }, privatePayload: Object.fromEntries(deltas.map((delta) => [delta.playerId, { pesosDelta: delta.pesosDelta }])) })
    }
  }
  return publicEvents
}

export class GameService {
  constructor(private readonly pool: Pool, private readonly pepper: string, private readonly now: () => number = Date.now, private readonly onIsolate: (roomCode: string) => void = () => undefined) {}

  async latest(sessionId: string, roomCode: string): Promise<GameCommandResult> {
    return withTransaction<GameCommandResult>(this.pool, async (client) => {
      const session = await lockSession(client, sessionId)
      const authError = sessionError(session, this.now())
      if (authError || !session?.active_room_id) return reject(authError ?? 'NOT_MEMBER')
      const room = await lockRoom(client, session.active_room_id)
      if (!room || room.code !== roomCode) return reject('ROOM_NOT_FOUND')
      if (room.status === 'isolated') return reject('ROOM_ISOLATED')
      if (room.status !== 'playing' && room.status !== 'finished') return reject('ROOM_CLOSED')
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
      const result = await client.query<{ public_payload: unknown; private_payload: Record<string, { pesosDelta: number }> | null }>('SELECT public_payload, private_payload FROM events WHERE room_id = $1 AND event_type = $2 ORDER BY revision', [room.id, 'voyage.settled'])
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
      const seed = randomBytes(4).readUInt32BE(0)
      const starter = roomMembers[randomInt(roomMembers.length)]
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
      const action = toGameAction(game.snapshot, viewer.player_id, input.action)
      const transitioned = transition(structuredClone(game.snapshot), action)
      if (!transitioned.ok) return this.recordReject(client, room, sessionId, input.commandId, requestDigest, 'RULE_REJECTED')
      if (validateState(transitioned.value.state).length > 0) throw new Error('迁移产生非法游戏状态')
      if (transitioned.value.state.phase.kind === 'gameOver') room.status = 'finished'
      room.revision += 1
      await client.query('UPDATE rooms SET status = $1, revision = $2 WHERE id = $3', [room.status, room.revision, room.id])
      await client.query('UPDATE games SET snapshot = $1, updated_at = now() WHERE room_id = $2', [JSON.stringify(transitioned.value.state), room.id])
      for (const event of publicEvents(transitioned.value.events, roomMembers)) await client.query('INSERT INTO events (room_id, revision, event_type, public_payload, private_payload) VALUES ($1, $2, $3, $4, $5)', [room.id, room.revision, event.eventType, JSON.stringify(event.payload), event.privatePayload === undefined ? null : JSON.stringify(event.privatePayload)])
      const accepted: GameCommandResult = { kind: 'accepted', snapshot: project(room, transitioned.value.state, roomMembers, viewer) }
      await saveCommand(client, room.id, sessionId, input.commandId, requestDigest, accepted, room.revision)
      return accepted
    })
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

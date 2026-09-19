import { createHmac, randomBytes, randomInt } from 'node:crypto'
import {
  ACCESS_TOKEN_ALPHABET,
  LobbySnapshotSchema,
  type LobbySnapshot,
  type PirateVariant,
} from '@manila/protocol'
import type { Pool, PoolClient } from 'pg'
import { withTransaction } from '../persistence/database.js'

type RoomRow = {
  id: string
  code: string
  status: 'lobby' | 'playing' | 'finished' | 'isolated' | 'closed'
  pirate_variant: PirateVariant
  revision: number
}

type SessionRow = {
  id: string
  active_room_id: string | null
  expires_at: Date
  revoked_at: Date | null
  token_revoked_at: Date | null
}

type MemberRow = {
  session_id: string
  nickname: string
  seat: number
  is_ready: boolean
}

type StoredCommand = {
  request_digest: string
  accepted: boolean
  result: CommandResult
}

export type CommandResult =
  | { kind: 'accepted'; snapshot: LobbySnapshot }
  | { kind: 'rejected'; code: LobbyErrorCode }

export type LobbyErrorCode =
  | 'AUTH_REQUIRED'
  | 'TOKEN_REVOKED'
  | 'NOT_MEMBER'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_CLOSED'
  | 'ALREADY_IN_ROOM'
  | 'NOT_HOST'
  | 'REVISION_CONFLICT'
  | 'COMMAND_ID_REUSED'

const emptySnapshot = LobbySnapshotSchema.parse({
  room: null,
  viewer: { canSetReady: false, canEditPirateVariant: false, canLeave: false, isReady: false },
})

function roomCode() {
  let code = ''
  for (let index = 0; index < 8; index += 1) code += ACCESS_TOKEN_ALPHABET[randomInt(ACCESS_TOKEN_ALPHABET.length)]
  return code
}

function opaqueId() {
  return randomBytes(16).toString('hex')
}

function requestDigest(value: unknown, pepper: string) {
  return createHmac('sha256', pepper).update('manila/lobby-command/v1\0').update(JSON.stringify(value)).digest('hex')
}

function rejected(code: LobbyErrorCode): CommandResult {
  return { kind: 'rejected', code }
}

async function detachClosedLobbies(client: PoolClient, roomIds: string[]) {
  if (roomIds.length === 0) return
  const detached = await client.query<{ session_id: string }>(
    `DELETE FROM room_members
      WHERE room_id = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM games WHERE games.room_id = room_members.room_id)
      RETURNING session_id`,
    [roomIds],
  )
  const sessionIds = detached.rows.map((row) => row.session_id)
  if (sessionIds.length > 0) {
    await client.query('UPDATE sessions SET active_room_id = NULL WHERE id = ANY($1::text[])', [sessionIds])
  }
}

/** Closes lobby rooms with no persistent activity since the idle cutoff. Returns closed room codes. */
export async function closeInactiveLobbies(pool: Pool, idleMs: number, nowMs: number = Date.now()): Promise<string[]> {
  const cutoff = new Date(nowMs - idleMs)
  return withTransaction(pool, async (client) => {
    const stale = await client.query<{ id: string; code: string }>(
      `SELECT rooms.id, rooms.code
         FROM rooms
        WHERE rooms.status = 'lobby'
          AND GREATEST(
            rooms.created_at,
            COALESCE((SELECT max(room_members.joined_at) FROM room_members WHERE room_members.room_id = rooms.id), rooms.created_at),
            COALESCE((SELECT max(commands.created_at) FROM commands WHERE commands.room_id = rooms.id), rooms.created_at)
          ) < $1
        FOR UPDATE`,
      [cutoff],
    )
    if (stale.rows.length === 0) return []
    const roomIds = stale.rows.map((row) => row.id)
    await client.query(
      `UPDATE rooms SET status = 'closed', closed_at = COALESCE(closed_at, now()), revision = revision + 1 WHERE id = ANY($1::text[])`,
      [roomIds],
    )
    await detachClosedLobbies(client, roomIds)
    return stale.rows.map((row) => row.code)
  })
}

/** Closes one room by code. Lobby rooms without a game release their members. */
export async function closeRoomByCode(pool: Pool, code: string): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const found = await client.query<{ id: string; status: string }>('SELECT id, status FROM rooms WHERE code = $1 FOR UPDATE', [code])
    const room = found.rows[0]
    if (!room || room.status === 'closed') return false
    await client.query(
      `UPDATE rooms SET status = 'closed', closed_at = COALESCE(closed_at, now()), revision = revision + 1 WHERE id = $1`,
      [room.id],
    )
    await detachClosedLobbies(client, [room.id])
    return true
  })
}

async function lockSession(client: PoolClient, sessionId: string): Promise<SessionRow | null> {
  const result = await client.query<SessionRow>(
    `SELECT sessions.id, sessions.active_room_id, sessions.expires_at, sessions.revoked_at,
            access_tokens.revoked_at AS token_revoked_at
       FROM sessions JOIN access_tokens ON access_tokens.id = sessions.token_id
      WHERE sessions.id = $1
      FOR UPDATE OF sessions`,
    [sessionId],
  )
  return result.rows[0] ?? null
}

function sessionFailure(session: SessionRow | null, now: number): LobbyErrorCode | null {
  if (!session || session.revoked_at || session.expires_at.getTime() <= now) return 'AUTH_REQUIRED'
  if (session.token_revoked_at) return 'TOKEN_REVOKED'
  return null
}

async function lockRoomById(client: PoolClient, roomId: string) {
  const result = await client.query<RoomRow>(
    'SELECT id, code, status, pirate_variant, revision FROM rooms WHERE id = $1 FOR UPDATE',
    [roomId],
  )
  return result.rows[0] ?? null
}

async function findRoomIdByCode(pool: Pool, code: string) {
  const result = await pool.query<{ id: string }>('SELECT id FROM rooms WHERE code = $1', [code])
  return result.rows[0]?.id ?? null
}

async function findCommand(client: PoolClient, scopeKey: string, sessionId: string, commandId: string) {
  const result = await client.query<StoredCommand>(
    `SELECT request_digest, accepted, result
       FROM commands WHERE scope_key = $1 AND session_id = $2 AND command_id = $3`,
    [scopeKey, sessionId, commandId],
  )
  return result.rows[0] ?? null
}

async function saveCommand(
  client: PoolClient,
  input: { roomId: string | null; scopeKey: string; sessionId: string; commandId: string; digest: string; result: CommandResult },
) {
  await client.query(
    `INSERT INTO commands (room_id, session_id, scope_key, command_id, request_digest, accepted, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.roomId,
      input.sessionId,
      input.scopeKey,
      input.commandId,
      input.digest,
      input.result.kind === 'accepted',
      JSON.stringify(input.result),
    ],
  )
}

async function replayOrReuse(
  client: PoolClient,
  scopeKey: string,
  sessionId: string,
  commandId: string,
  digest: string,
) {
  const command = await findCommand(client, scopeKey, sessionId, commandId)
  if (!command) return null
  if (command.request_digest !== digest) return rejected('COMMAND_ID_REUSED')
  return command.result
}

async function replayExitedLeave(client: PoolClient, sessionId: string, commandId: string, digest: string) {
  const result = await client.query<StoredCommand>(
    `SELECT request_digest, accepted, result FROM commands
      WHERE session_id = $1 AND command_id = $2 AND room_id IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [sessionId, commandId],
  )
  const command = result.rows[0]
  if (!command) return null
  if (command.request_digest !== digest) return rejected('COMMAND_ID_REUSED')
  return command.result
}

async function membersFor(client: PoolClient, roomId: string) {
  const result = await client.query<MemberRow>(
    `SELECT session_id, nickname, seat, is_ready
       FROM room_members WHERE room_id = $1 ORDER BY seat`,
    [roomId],
  )
  return result.rows
}

async function snapshotFor(client: PoolClient, room: RoomRow, viewerSessionId: string): Promise<LobbySnapshot> {
  const members = await membersFor(client, room.id)
  const hostSeat = members[0]?.seat
  const viewer = members.find((member) => member.session_id === viewerSessionId)
  return LobbySnapshotSchema.parse({
    room: {
      code: room.code,
      revision: room.revision,
      status: room.status === 'finished' ? 'finished' : room.status === 'playing' ? 'playing' : room.status === 'closed' ? 'closed' : 'lobby',
      pirateVariant: room.pirate_variant,
      members: members.map((member) => ({
        nickname: member.nickname,
        seat: member.seat,
        ready: member.is_ready,
        isHost: member.seat === hostSeat,
      })),
    },
    viewer: {
      canSetReady: Boolean(viewer),
      canEditPirateVariant: viewer?.seat === hostSeat,
      canLeave: Boolean(viewer),
      isReady: viewer?.is_ready ?? false,
    },
  })
}

async function activeRoomSnapshot(client: PoolClient, session: SessionRow) {
  if (!session.active_room_id) return emptySnapshot
  const room = await client.query<RoomRow>(
    'SELECT id, code, status, pirate_variant, revision FROM rooms WHERE id = $1',
    [session.active_room_id],
  )
  const current = room.rows[0]
  if (!current || (current.status !== 'lobby' && current.status !== 'playing' && current.status !== 'finished' && current.status !== 'closed')) return emptySnapshot
  return snapshotFor(client, current, session.id)
}

export class LobbyService {
  constructor(
    private readonly pool: Pool,
    private readonly pepper: string,
    private readonly now: () => number = Date.now,
  ) {}

  async getLobby(sessionId: string) {
    return withTransaction(this.pool, async (client) => {
      const session = await lockSession(client, sessionId)
      const failure = sessionFailure(session, this.now())
      if (failure) return rejected(failure)
      if (!session) return rejected('AUTH_REQUIRED')
      return { kind: 'accepted' as const, snapshot: await activeRoomSnapshot(client, session) }
    })
  }

  async createRoom(sessionId: string, input: { commandId: string; nickname: string; pirateVariant: PirateVariant }) {
    return withTransaction(this.pool, async (client) => {
      const digest = requestDigest(input, this.pepper)
      const scopeKey = `session:${sessionId}`
      const session = await lockSession(client, sessionId)
      const replay = await replayOrReuse(client, scopeKey, sessionId, input.commandId, digest)
      if (replay) return replay
      const failure = sessionFailure(session, this.now())
      if (failure) return rejected(failure)
      if (!session) return rejected('AUTH_REQUIRED')
      if (session.active_room_id) {
        const result = rejected('ALREADY_IN_ROOM')
        await saveCommand(client, { roomId: null, scopeKey, sessionId, commandId: input.commandId, digest, result })
        return result
      }
      const room: RoomRow = {
        id: opaqueId(),
        code: roomCode(),
        status: 'lobby',
        pirate_variant: input.pirateVariant,
        revision: 1,
      }
      await client.query(
        `INSERT INTO rooms (id, code, status, pirate_variant, revision) VALUES ($1, $2, $3, $4, $5)`,
        [room.id, room.code, room.status, room.pirate_variant, room.revision],
      )
      await client.query('UPDATE sessions SET active_room_id = $1 WHERE id = $2', [room.id, sessionId])
      await client.query(
        `INSERT INTO room_members (room_id, session_id, player_id, nickname, seat) VALUES ($1, $2, $3, $4, 1)`,
        [room.id, sessionId, `player-${opaqueId()}`, input.nickname],
      )
      const result: CommandResult = { kind: 'accepted', snapshot: await snapshotFor(client, room, sessionId) }
      await saveCommand(client, { roomId: room.id, scopeKey, sessionId, commandId: input.commandId, digest, result })
      return result
    })
  }

  async joinRoom(sessionId: string, input: { commandId: string; roomCode: string; nickname: string }) {
    const targetRoomId = await findRoomIdByCode(this.pool, input.roomCode)
    return withTransaction(this.pool, async (client) => {
      const digest = requestDigest(input, this.pepper)
      const scopeKey = `session:${sessionId}`
      const session = await lockSession(client, sessionId)
      const room = targetRoomId ? await lockRoomById(client, targetRoomId) : null
      const replay = await replayOrReuse(client, scopeKey, sessionId, input.commandId, digest)
      if (replay) return replay
      const failure = sessionFailure(session, this.now())
      if (failure) return rejected(failure)
      if (!session) return rejected('AUTH_REQUIRED')
      if (!room) {
        const result = rejected('ROOM_NOT_FOUND')
        await saveCommand(client, { roomId: null, scopeKey, sessionId, commandId: input.commandId, digest, result })
        return result
      }
      if (session.active_room_id && session.active_room_id !== room.id) {
        const result = rejected('ALREADY_IN_ROOM')
        await saveCommand(client, { roomId: room.id, scopeKey, sessionId, commandId: input.commandId, digest, result })
        return result
      }
      if (room.status !== 'lobby') {
        const result = rejected('ROOM_CLOSED')
        await saveCommand(client, { roomId: room.id, scopeKey, sessionId, commandId: input.commandId, digest, result })
        return result
      }
      const members = await membersFor(client, room.id)
      const existing = members.find((member) => member.session_id === sessionId)
      if (existing) {
        const result: CommandResult = { kind: 'accepted', snapshot: await snapshotFor(client, room, sessionId) }
        await saveCommand(client, { roomId: room.id, scopeKey, sessionId, commandId: input.commandId, digest, result })
        return result
      }
      if (members.length >= 5) {
        const result = rejected('ROOM_FULL')
        await saveCommand(client, { roomId: room.id, scopeKey, sessionId, commandId: input.commandId, digest, result })
        return result
      }
      const occupied = new Set(members.map((member) => member.seat))
      const seat = [1, 2, 3, 4, 5].find((candidate) => !occupied.has(candidate))
      if (!seat) {
        const result = rejected('ROOM_FULL')
        await saveCommand(client, { roomId: room.id, scopeKey, sessionId, commandId: input.commandId, digest, result })
        return result
      }
      await client.query('UPDATE sessions SET active_room_id = $1 WHERE id = $2', [room.id, sessionId])
      await client.query(
        `INSERT INTO room_members (room_id, session_id, player_id, nickname, seat)
         VALUES ($1, $2, $3, $4, $5)`,
        [room.id, sessionId, `player-${opaqueId()}`, input.nickname, seat],
      )
      await client.query('UPDATE room_members SET is_ready = false WHERE room_id = $1', [room.id])
      room.revision += 1
      await client.query('UPDATE rooms SET revision = $1 WHERE id = $2', [room.revision, room.id])
      const result: CommandResult = { kind: 'accepted', snapshot: await snapshotFor(client, room, sessionId) }
      await saveCommand(client, { roomId: room.id, scopeKey, sessionId, commandId: input.commandId, digest, result })
      return result
    })
  }

  async setReady(sessionId: string, roomCode: string, input: { commandId: string; expectedRevision: number; ready: boolean }) {
    return this.memberCommand(sessionId, roomCode, input, async (client, room) => {
      await client.query('UPDATE room_members SET is_ready = $1 WHERE room_id = $2 AND session_id = $3', [input.ready, room.id, sessionId])
      room.revision += 1
      await client.query('UPDATE rooms SET revision = $1 WHERE id = $2', [room.revision, room.id])
      return { kind: 'accepted', snapshot: await snapshotFor(client, room, sessionId) }
    })
  }

  async setPirateVariant(sessionId: string, roomCode: string, input: { commandId: string; expectedRevision: number; pirateVariant: PirateVariant }) {
    return this.memberCommand(sessionId, roomCode, input, async (client, room, member, members) => {
      const hostSeat = members[0]?.seat
      if (member.seat !== hostSeat) return rejected('NOT_HOST')
      if (room.pirate_variant === input.pirateVariant) {
        return { kind: 'accepted', snapshot: await snapshotFor(client, room, sessionId) }
      }
      room.pirate_variant = input.pirateVariant
      room.revision += 1
      await client.query('UPDATE room_members SET is_ready = false WHERE room_id = $1', [room.id])
      await client.query('UPDATE rooms SET pirate_variant = $1, revision = $2 WHERE id = $3', [room.pirate_variant, room.revision, room.id])
      return { kind: 'accepted', snapshot: await snapshotFor(client, room, sessionId) }
    })
  }

  async leaveRoom(sessionId: string, roomCode: string, input: { commandId: string; expectedRevision: number }) {
    return this.memberCommand(sessionId, roomCode, input, async (client, room) => {
      await client.query('DELETE FROM room_members WHERE room_id = $1 AND session_id = $2', [room.id, sessionId])
      await client.query('UPDATE sessions SET active_room_id = NULL WHERE id = $1', [sessionId])
      const remaining = await membersFor(client, room.id)
      room.revision += 1
      if (remaining.length === 0) {
        room.status = 'closed'
        await client.query('UPDATE rooms SET status = $1, closed_at = now(), revision = $2 WHERE id = $3', [room.status, room.revision, room.id])
      } else {
        await client.query('UPDATE room_members SET is_ready = false WHERE room_id = $1', [room.id])
        await client.query('UPDATE rooms SET revision = $1 WHERE id = $2', [room.revision, room.id])
      }
      return { kind: 'accepted', snapshot: emptySnapshot }
    })
  }

  private async memberCommand<T extends { commandId: string; expectedRevision: number }>(
    sessionId: string,
    roomCode: string,
    input: T,
    apply: (client: PoolClient, room: RoomRow, member: MemberRow, members: MemberRow[]) => Promise<CommandResult>,
  ) {
    return withTransaction(this.pool, async (client) => {
      const digest = requestDigest(input, this.pepper)
      const session = await lockSession(client, sessionId)
      const failure = sessionFailure(session, this.now())
      if (failure) return rejected(failure)
      if (!session) return rejected('AUTH_REQUIRED')
      if (!session.active_room_id) {
        const replay = await replayExitedLeave(client, sessionId, input.commandId, digest)
        return replay ?? rejected('NOT_MEMBER')
      }
      const room = await lockRoomById(client, session.active_room_id)
      if (!room) return rejected('NOT_MEMBER')
      if (room.code !== roomCode) return rejected('ROOM_NOT_FOUND')
      const scopeKey = `room:${room.id}`
      const replay = await replayOrReuse(client, scopeKey, sessionId, input.commandId, digest)
      if (replay) return replay
      if (room.status !== 'lobby') {
        const result = rejected('ROOM_CLOSED')
        await saveCommand(client, { roomId: room.id, scopeKey, sessionId, commandId: input.commandId, digest, result })
        return result
      }
      const members = await membersFor(client, room.id)
      const member = members.find((candidate) => candidate.session_id === sessionId)
      if (!member) return rejected('NOT_MEMBER')
      if (room.revision !== input.expectedRevision) {
        const result = rejected('REVISION_CONFLICT')
        await saveCommand(client, { roomId: room.id, scopeKey, sessionId, commandId: input.commandId, digest, result })
        return result
      }
      const result = await apply(client, room, member, members)
      await saveCommand(client, { roomId: room.id, scopeKey, sessionId, commandId: input.commandId, digest, result })
      return result
    })
  }
}

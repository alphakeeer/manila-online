import { z } from 'zod'

export const ACCESS_TOKEN_LENGTH = 8
export const ACCESS_TOKEN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const PROTOCOL_VERSION = 1

export function normalizeAccessToken(value: string) {
  return value.trim().toUpperCase()
}

export const AccessTokenInputSchema = z
  .string()
  .transform(normalizeAccessToken)
  .pipe(
    z
      .string()
      .length(ACCESS_TOKEN_LENGTH)
      .regex(new RegExp(`^[${ACCESS_TOKEN_ALPHABET}]+$`)),
  )

export const LoginRequestSchema = z
  .object({ token: AccessTokenInputSchema })
  .strict()

export const SessionViewSchema = z
  .object({
    expiresAt: z.string().datetime(),
  })
  .strict()

export const SessionResponseSchema = z
  .object({ session: SessionViewSchema })
  .strict()

export const ApiErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'TOKEN_REVOKED',
  'INVALID_ACCESS_TOKEN',
  'ORIGIN_FORBIDDEN',
  'RATE_LIMITED',
  'STORAGE_UNAVAILABLE',
  'VALIDATION_ERROR',
  'NOT_MEMBER',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_CLOSED',
  'ALREADY_IN_ROOM',
  'NOT_HOST',
  'REVISION_CONFLICT',
  'COMMAND_ID_REUSED',
  'RULE_REJECTED',
  'ACTION_NOT_AVAILABLE',
  'START_NOT_READY',
  'GAME_NOT_FOUND',
  'ROOM_ISOLATED',
  'PROTOCOL_VERSION_UNSUPPORTED',
])

export const ApiErrorSchema = z
  .object({
    code: ApiErrorCodeSchema,
  })
  .strict()

export type LoginRequest = z.infer<typeof LoginRequestSchema>
export type SessionView = z.infer<typeof SessionViewSchema>
export type SessionResponse = z.infer<typeof SessionResponseSchema>
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

export const PirateVariantSchema = z.enum(['standard', 'strengthened'])
export const CommandIdSchema = z.string().trim().min(1).max(128)
export const NicknameSchema = z.string().trim().min(1).max(24)
export const RevisionSchema = z.number().int().nonnegative()

export const CreateRoomRequestSchema = z
  .object({
    commandId: CommandIdSchema,
    nickname: NicknameSchema,
    pirateVariant: PirateVariantSchema.optional(),
  })
  .strict()

export const JoinRoomRequestSchema = z
  .object({
    commandId: CommandIdSchema,
    roomCode: z.string().trim().toUpperCase().length(8).regex(new RegExp(`^[${ACCESS_TOKEN_ALPHABET}]+$`)),
    nickname: NicknameSchema,
  })
  .strict()

export const SetReadyRequestSchema = z
  .object({ commandId: CommandIdSchema, expectedRevision: RevisionSchema, ready: z.boolean() })
  .strict()

export const SetPirateVariantRequestSchema = z
  .object({ commandId: CommandIdSchema, expectedRevision: RevisionSchema, pirateVariant: PirateVariantSchema })
  .strict()

export const LeaveRoomRequestSchema = z
  .object({ commandId: CommandIdSchema, expectedRevision: RevisionSchema })
  .strict()

export const RoomMemberViewSchema = z
  .object({
    nickname: z.string(),
    seat: z.number().int().min(1).max(5),
    ready: z.boolean(),
    isHost: z.boolean(),
  })
  .strict()

export const LobbySnapshotSchema = z
  .object({
    room: z
      .object({
        code: z.string(),
        revision: RevisionSchema,
        status: z.enum(['lobby', 'playing', 'finished']),
        pirateVariant: PirateVariantSchema,
        members: z.array(RoomMemberViewSchema),
      })
      .strict()
      .nullable(),
    viewer: z
      .object({
        canSetReady: z.boolean(),
        canEditPirateVariant: z.boolean(),
        canLeave: z.boolean(),
        isReady: z.boolean(),
      })
      .strict(),
  })
  .strict()

export type PirateVariant = z.infer<typeof PirateVariantSchema>
export type LobbySnapshot = z.infer<typeof LobbySnapshotSchema>

const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION)
export const StartGameRequestSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  commandId: CommandIdSchema,
  expectedRevision: RevisionSchema,
}).strict()

export const AuctionActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bid'), amount: z.number().int().nonnegative(), mortgageShareIds: z.array(z.string().min(1)).max(5) }).strict(),
  z.object({ type: z.literal('passAuction') }).strict(),
])

export const UnavailableActionSchema = z.object({
  type: z.enum(['buyShare', 'selectCargo', 'launchBoats', 'placeAccomplice', 'passPlacement', 'moveBoat', 'pilotMove', 'boardPirate', 'choosePlunderDestination', 'mortgageShare', 'redeemShare']),
}).strict()

export const GameCommandRequestSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  commandId: CommandIdSchema,
  expectedRevision: RevisionSchema,
  action: z.union([AuctionActionSchema, UnavailableActionSchema]),
}).strict()

const CommoditySchema = z.enum(['nutmeg', 'silk', 'jade', 'ginseng'])
const BoatStatusSchema = z.enum(['unlaunched', 'sailing', 'port', 'shipyard'])
export const GameRoomSnapshotSchema = z.object({
  room: z.object({ code: z.string(), revision: RevisionSchema, pirateVariant: PirateVariantSchema, status: z.enum(['playing', 'finished']) }).strict(),
  public: z.object({
    voyage: z.number().int().positive(),
    phase: z.object({ kind: z.string(), currentSeat: z.number().int().min(1).max(5).nullable() }).strict(),
    harborMasterSeat: z.number().int().min(1).max(5).nullable(),
    highestBid: z.object({ amount: z.number().int().nonnegative(), bidderSeat: z.number().int().min(1).max(5) }).strict().nullable(),
    market: z.record(CommoditySchema, z.number().int()),
    boats: z.array(z.object({ id: z.string(), commodity: CommoditySchema.nullable(), lane: z.number().int().min(0).max(2).nullable(), position: z.number().int().nullable(), status: BoatStatusSchema, berth: z.enum(['A', 'B', 'C']).nullable(), plundered: z.boolean() }).strict()),
    players: z.array(z.object({ seat: z.number().int().min(1).max(5), nickname: z.string() }).strict()),
    shareSupply: z.record(CommoditySchema, z.number().int().nonnegative()),
  }).strict(),
  self: z.object({ seat: z.number().int().min(1).max(5), pesos: z.number().int().nonnegative(), shares: z.array(z.object({ id: z.string(), commodity: CommoditySchema, mortgaged: z.boolean() }).strict()) }).strict(),
  decision: z.object({ kind: z.literal('auction'), minimumBid: z.number().int().positive(), maximumBid: z.number().int().nonnegative(), availableCollateralShareIds: z.array(z.string()) }).strict().nullable(),
}).strict()

export type GameRoomSnapshot = z.infer<typeof GameRoomSnapshotSchema>
export type GameCommandRequest = z.infer<typeof GameCommandRequestSchema>

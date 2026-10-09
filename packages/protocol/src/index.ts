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
  'SEAT_NOT_CLAIMABLE',
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
        status: z.enum(['lobby', 'playing', 'finished', 'closed']),
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

/** Who drives a seat: null = the player; 'away' = server bot while they are gone; 'manual' = bot by request. */
export const SeatAutopilotSchema = z.enum(['away', 'manual'])
export type SeatAutopilot = z.infer<typeof SeatAutopilotSchema>
export const SetAutopilotRequestSchema = z.object({ enabled: z.boolean() }).strict()
export const StartGameRequestSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  commandId: CommandIdSchema,
  expectedRevision: RevisionSchema,
}).strict()

const CommoditySchema = z.enum(['nutmeg', 'silk', 'jade', 'ginseng'])
const LaneSchema = z.union([z.literal(0), z.literal(1), z.literal(2)])
const BoatStatusSchema = z.enum(['unlaunched', 'sailing', 'port', 'shipyard'])

export const AuctionActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bid'), amount: z.number().int().nonnegative(), mortgageShareIds: z.array(z.string().min(1)).max(5) }).strict(),
  z.object({ type: z.literal('passAuction') }).strict(),
])

export const GameActionSchema = z.discriminatedUnion('type', [
  ...AuctionActionSchema.options,
  z.object({ type: z.literal('buyShare'), commodity: CommoditySchema.nullable(), mortgageShareIds: z.array(z.string().min(1)).max(5) }).strict(),
  z.object({ type: z.literal('selectCargo'), commodities: z.array(CommoditySchema).max(4) }).strict(),
  z.object({ type: z.literal('launchBoats'), assignments: z.array(z.object({ boatId: z.string().min(1), commodity: CommoditySchema, lane: LaneSchema, startPosition: z.number().int() }).strict()).max(3) }).strict(),
  z.object({ type: z.literal('placeAccomplice'), location: z.object({ area: z.enum(['cargo', 'port', 'shipyard', 'pirateCaptain', 'pirateCrew', 'smallPilot', 'largePilot', 'insurance']), boatId: z.string().min(1).optional(), slot: z.number().int().nonnegative().optional(), berth: z.enum(['A', 'B', 'C']).optional() }).strict(), mortgageShareIds: z.array(z.string().min(1)).max(5), stowaway: z.boolean() }).strict(),
  z.object({ type: z.literal('passPlacement') }).strict(),
  z.object({ type: z.literal('moveBoat'), boatId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('pilotMove'), moves: z.array(z.object({ boatId: z.string().min(1), delta: z.union([z.literal(-2), z.literal(-1), z.literal(1), z.literal(2)]) }).strict()).max(2) }).strict(),
  z.object({ type: z.literal('boardPirate'), accompliceId: z.string().min(1), boatId: z.string().min(1).nullable(), displacedAccompliceId: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal('choosePlunderDestination'), boatId: z.string().min(1), destination: z.enum(['port', 'shipyard']) }).strict(),
  z.object({ type: z.literal('mortgageShare'), shareId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('redeemShare'), shareId: z.string().min(1) }).strict(),
])

export const GameCommandRequestSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  commandId: CommandIdSchema,
  expectedRevision: RevisionSchema,
  action: GameActionSchema,
}).strict()

const DecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('auction'), minimumBid: z.number().int().positive(), maximumBid: z.number().int().nonnegative(), availableCollateralShareIds: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal('sharePurchase'), available: z.array(z.object({ commodity: CommoditySchema, price: z.number().int().nonnegative() }).strict()), availableCollateralShareIds: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal('cargoSelection'), commodities: z.array(CommoditySchema) }).strict(),
  z.object({ kind: z.literal('launch'), boatIds: z.array(z.string()), commodities: z.array(CommoditySchema), lanes: z.array(LaneSchema), startPositionTriples: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int()])) }).strict(),
  z.object({ kind: z.literal('placement'), placementRound: z.number().int().positive(), options: z.array(z.object({ location: z.object({ area: z.string(), boatId: z.string().optional(), slot: z.number().int().optional(), berth: z.enum(['A', 'B', 'C']).optional() }).strict(), cost: z.number().int().nonnegative() }).strict()), canStowaway: z.boolean(), canPass: z.boolean(), availableCollateralShareIds: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal('movementOrder'), movementRound: z.number().int().positive(), dice: z.record(CommoditySchema, z.number().int()), remainingBoatIds: z.array(z.string()) }).strict(),
  z.object({ kind: z.enum(['smallPilot', 'largePilot']), movableBoatIds: z.array(z.string()), legalMoves: z.array(z.array(z.object({ boatId: z.string(), delta: z.union([z.literal(-2), z.literal(-1), z.literal(1), z.literal(2)]) }).strict())) }).strict(),
  z.object({ kind: z.literal('pirateBoarding'), accompliceId: z.string(), eligibleBoatIds: z.array(z.string()), displaceableByBoat: z.record(z.string(), z.array(z.string())), canStay: z.boolean() }).strict(),
  z.object({ kind: z.literal('plunderDestination'), boatId: z.string(), destinations: z.array(z.enum(['port', 'shipyard'])) }).strict(),
])
export const GameRoomSnapshotSchema = z.object({
  room: z.object({ code: z.string(), revision: RevisionSchema, pirateVariant: PirateVariantSchema, status: z.enum(['playing', 'finished', 'closed']), readOnly: z.boolean() }).strict(),
  public: z.object({
    voyage: z.number().int().positive(),
      phase: z.object({ kind: z.string(), currentSeat: z.number().int().min(1).max(5).nullable(), dice: z.record(CommoditySchema, z.number().int()).nullable() }).strict(),
    harborMasterSeat: z.number().int().min(1).max(5).nullable(),
    highestBid: z.object({ amount: z.number().int().nonnegative(), bidderSeat: z.number().int().min(1).max(5) }).strict().nullable(),
    market: z.record(CommoditySchema, z.number().int()),
      boats: z.array(z.object({ id: z.string(), commodity: CommoditySchema.nullable(), lane: z.number().int().min(0).max(2).nullable(), position: z.number().int().nullable(), status: BoatStatusSchema, berth: z.enum(['A', 'B', 'C']).nullable(), plundered: z.boolean() }).strict()),
      accomplices: z.array(z.object({ id: z.string(), seat: z.number().int().min(1).max(5), location: z.object({ area: z.string(), boatId: z.string().optional(), slot: z.number().int().optional(), berth: z.enum(['A', 'B', 'C']).optional() }).strict().nullable() }).strict()),
    players: z.array(z.object({ seat: z.number().int().min(1).max(5), nickname: z.string(), autopilot: SeatAutopilotSchema.nullable() }).strict()),
    shareSupply: z.record(CommoditySchema, z.number().int().nonnegative()),
    standings: z.array(z.object({ seat: z.number().int().min(1).max(5), nickname: z.string(), wealth: z.number().int(), winner: z.boolean() }).strict()).nullable(),
  }).strict(),
  self: z.object({ seat: z.number().int().min(1).max(5), pesos: z.number().int().nonnegative(), shares: z.array(z.object({ id: z.string(), commodity: CommoditySchema, mortgaged: z.boolean() }).strict()) }).strict(),
  decision: DecisionSchema.nullable(),
}).strict()

export const SettlementIncomeSchema = z.object({
  category: z.enum(['cargo', 'plunder', 'portBerth', 'shipyardBerth', 'forcedMortgage']),
  amount: z.number(),
  playerId: z.string().min(1).optional(),
  boatId: z.string().min(1).optional(),
  commodity: CommoditySchema.optional(),
  berth: z.enum(['A', 'B', 'C']).optional(),
  paidBy: z.enum(['treasury', 'insurance']).optional(),
}).strict()

export const SettlementPaymentSchema = z.object({
  category: z.literal('insurance'),
  amount: z.number(),
  berth: z.enum(['A', 'B', 'C']),
  receiverId: z.string().min(1).nullable(),
  coveredByTreasury: z.number(),
}).strict()

export const SettlementPublicSchema = z.object({
  voyage: z.number().int().positive(),
  boats: z.array(z.object({ id: z.string(), commodity: CommoditySchema.nullable(), status: BoatStatusSchema, berth: z.enum(['A', 'B', 'C']).nullable(), plundered: z.boolean() }).strict()),
  market: z.array(z.object({ commodity: CommoditySchema, from: z.number(), to: z.number() }).strict()),
}).strict()

export const SettlementEntrySchema = z.object({
  voyage: z.number().int().positive(),
  public: SettlementPublicSchema,
  self: z.object({
    incomes: z.array(SettlementIncomeSchema),
    payments: z.array(SettlementPaymentSchema),
    pesosDelta: z.number(),
  }).strict().nullable(),
}).strict()

export const SettlementHistorySchema = z.object({
  settlements: z.array(SettlementEntrySchema),
}).strict()

export type GameRoomSnapshot = z.infer<typeof GameRoomSnapshotSchema>
export type GameCommandRequest = z.infer<typeof GameCommandRequestSchema>
export type SettlementHistory = z.infer<typeof SettlementHistorySchema>
export type SettlementEntry = z.infer<typeof SettlementEntrySchema>
export type SettlementIncomeView = z.infer<typeof SettlementIncomeSchema>
export type SettlementPaymentView = z.infer<typeof SettlementPaymentSchema>

export { chooseAction, type Action as AutopilotAction, type AutopilotStyle } from './autopilot.js'

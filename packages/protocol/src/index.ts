import { z } from 'zod'

export const ACCESS_TOKEN_LENGTH = 8
export const ACCESS_TOKEN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

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
  .object({ token: z.string() })
  .strict()
  .transform(({ token }) => ({ token: AccessTokenInputSchema.parse(token) }))

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

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

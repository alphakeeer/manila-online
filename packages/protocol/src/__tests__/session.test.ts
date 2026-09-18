import { describe, expect, it } from 'vitest'
import { AccessTokenInputSchema, LoginRequestSchema } from '../index.js'

describe('session protocol', () => {
  it('normalizes an allowed access token', () => {
    expect(AccessTokenInputSchema.parse('  a2bcdefg  ')).toBe('A2BCDEFG')
  })

  it('rejects ambiguous, malformed, and extra login input', () => {
    expect(() => AccessTokenInputSchema.parse('O2345678')).toThrow()
    expect(() => AccessTokenInputSchema.parse('234567')).toThrow()
    expect(() => LoginRequestSchema.parse({ token: '23456789', extra: true })).toThrow()
  })
})

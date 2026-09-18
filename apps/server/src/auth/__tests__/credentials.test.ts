import { describe, expect, it } from 'vitest'
import { ACCESS_TOKEN_ALPHABET } from '@manila/protocol'
import {
  digestAccessToken,
  digestSessionCredential,
  generateAccessToken,
  generateSessionCredential,
} from '../credentials.js'
import { FixedWindowRateLimiter } from '../rateLimit.js'

describe('credentials', () => {
  it('uses only the unambiguous access-token alphabet', () => {
    const token = generateAccessToken()
    expect(token).toHaveLength(8)
    expect([...token].every((character) => ACCESS_TOKEN_ALPHABET.includes(character))).toBe(true)
  })

  it('separates access-token and session credential digest domains', () => {
    expect(digestAccessToken('ABCDEFGH', 'pepper')).not.toBe(
      digestSessionCredential('ABCDEFGH', 'pepper'),
    )
    expect(generateSessionCredential()).toHaveLength(43)
  })
})

describe('FixedWindowRateLimiter', () => {
  it('uses a controllable time source', () => {
    let now = 0
    const limiter = new FixedWindowRateLimiter(2, 60_000, { now: () => now })
    expect(limiter.consume('session')).toBe(true)
    expect(limiter.consume('session')).toBe(true)
    expect(limiter.consume('session')).toBe(false)
    now = 60_000
    expect(limiter.consume('session')).toBe(true)
  })
})

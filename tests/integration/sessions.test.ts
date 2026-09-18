import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildServer } from '../../apps/server/src/server.js'
import { createPool } from '../../apps/server/src/persistence/database.js'
import { runMigrations } from '../../apps/server/src/persistence/migrations.js'
import { getTestDatabaseUrl, resetTestDatabase } from '../../apps/server/src/persistence/testDatabase.js'
import { createAccessToken, revokeAccessToken } from '../../apps/server/src/auth/repository.js'
import { digestAccessToken } from '../../apps/server/src/auth/credentials.js'

const testDatabaseUrl = getTestDatabaseUrl()
const migrationsDir = new URL('../../apps/server/migrations/', import.meta.url).pathname
const origin = 'http://localhost:5173'

let now = Date.UTC(2026, 8, 19, 0, 0, 0)
let pool: ReturnType<typeof createPool>
let app: ReturnType<typeof buildServer>

function cookieFrom(response: unknown) {
  const header = (response as { headers?: { 'set-cookie'?: unknown } }).headers?.['set-cookie']
  const value = Array.isArray(header) ? header[0] : typeof header === 'string' ? header : undefined
  if (!value) throw new Error('expected session cookie')
  return value.split(';', 1)[0]
}

beforeEach(async () => {
  now = Date.UTC(2026, 8, 19, 0, 0, 0)
  await resetTestDatabase(testDatabaseUrl)
  pool = createPool(testDatabaseUrl)
  await runMigrations(pool, migrationsDir)
  app = buildServer(
    {
      environment: 'test',
      host: '127.0.0.1',
      port: 3000,
      databaseUrl: testDatabaseUrl,
      authPepper: 'test-only-pepper',
      allowedOrigins: [origin],
      secureCookies: false,
      sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    },
    { pool, clock: { now: () => now } },
  )
})

afterEach(async () => app.close())

async function grant(token = '23456789') {
  await createAccessToken(pool, {
    id: 'token-id',
    digest: digestAccessToken(token, 'test-only-pepper'),
    label: null,
  })
  return token
}

describe('session HTTP slice', () => {
  it('normalizes a token, persists a refreshable session, and clears it on logout', async () => {
    const token = await grant()
    const login = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin },
      payload: { token: `  ${token.toLowerCase()}  ` },
    })

    expect(login.statusCode).toBe(200)
    expect(login.json()).toMatchObject({ session: { expiresAt: expect.any(String) } })
    expect(login.headers['set-cookie']).toContain('HttpOnly')
    expect(login.headers['set-cookie']).toContain('SameSite=Strict')
    expect(login.headers['set-cookie']).toContain('Path=/')
    expect(login.headers['set-cookie']).not.toContain('Secure')
    const cookie = cookieFrom(login)

    expect(
      await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } }),
    ).toMatchObject({ statusCode: 200 })
    expect(
      await app.inject({ method: 'DELETE', url: '/api/session', headers: { origin, cookie } }),
    ).toMatchObject({ statusCode: 204 })
    expect(
      await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } }),
    ).toMatchObject({ statusCode: 401, json: expect.any(Function) })
  })

  it('distinguishes revoked sessions, expiry, external origins, and rate limits without leaking token status', async () => {
    const token = await grant()
    const login = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin },
      payload: { token },
    })
    const cookie = cookieFrom(login)
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin },
      payload: { token: 'INVALID0' },
    })
    await revokeAccessToken(pool, 'token-id')
    const revoked = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin },
      payload: { token },
    })
    expect(invalid.json()).toEqual(revoked.json())

    expect(
      await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } }),
    ).toMatchObject({ statusCode: 401, body: JSON.stringify({ code: 'TOKEN_REVOKED' }) })

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin: 'https://elsewhere.example' },
      payload: { token },
    })
    expect(forbidden.json()).toEqual({ code: 'ORIGIN_FORBIDDEN' })
  })
})

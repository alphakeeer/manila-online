import type { Pool, PoolClient } from 'pg'

type Database = Pool | PoolClient

export interface AccessTokenRow {
  id: string
  token_digest: string
  revoked_at: Date | null
  label?: string | null
}

export async function listAccessTokens(database: Database) {
  const result = await database.query<AccessTokenRow & { created_at: Date }>('SELECT id, label, revoked_at, created_at FROM access_tokens ORDER BY created_at DESC')
  return result.rows
}

export interface SessionRow {
  id: string
  credential_digest: string
  token_id: string
  expires_at: Date
  revoked_at: Date | null
  token_revoked_at: Date | null
}

export async function createAccessToken(
  database: Database,
  input: { id: string; digest: string; label: string | null },
) {
  await database.query(
    'INSERT INTO access_tokens (id, token_digest, label) VALUES ($1, $2, $3)',
    [input.id, input.digest, input.label],
  )
}

async function notifyRevocation(database: Database, payload: { kind: 'token' | 'session'; id: string }) {
  await database.query('SELECT pg_notify($1, $2)', ['manila_revocation', JSON.stringify(payload)])
}

export async function revokeAccessToken(database: Database, tokenId: string) {
  const result = await database.query(
    'UPDATE access_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 RETURNING id',
    [tokenId],
  )
  if (result.rowCount !== 1) return false
  await notifyRevocation(database, { kind: 'token', id: tokenId })
  return true
}

export async function findAccessTokenByDigest(database: Database, digest: string) {
  const result = await database.query<AccessTokenRow>(
    'SELECT id, token_digest, revoked_at FROM access_tokens WHERE token_digest = $1',
    [digest],
  )
  return result.rows[0] ?? null
}

export async function createSession(
  database: Database,
  input: { id: string; credentialDigest: string; tokenId: string; expiresAt: Date },
) {
  await database.query(
    'INSERT INTO sessions (id, credential_digest, token_id, expires_at) VALUES ($1, $2, $3, $4)',
    [input.id, input.credentialDigest, input.tokenId, input.expiresAt],
  )
}

export async function findSessionByDigest(database: Database, credentialDigest: string) {
  const result = await database.query<SessionRow>(
    `SELECT sessions.id, sessions.credential_digest, sessions.token_id, sessions.expires_at,
            sessions.revoked_at, access_tokens.revoked_at AS token_revoked_at
       FROM sessions
       JOIN access_tokens ON access_tokens.id = sessions.token_id
      WHERE sessions.credential_digest = $1`,
    [credentialDigest],
  )
  return result.rows[0] ?? null
}

export async function revokeSession(database: Database, sessionId: string) {
  await database.query(
    'UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1',
    [sessionId],
  )
  await notifyRevocation(database, { kind: 'session', id: sessionId })
}

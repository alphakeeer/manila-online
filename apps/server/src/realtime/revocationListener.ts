import type { Pool } from 'pg'

/**
 * Listens for token/session revocation notices raised by the host CLI or by
 * other server processes. Callers use the callback to re-check subscribers.
 */
export async function startRevocationListener(pool: Pool, onChange: () => void): Promise<() => Promise<void>> {
  const client = await pool.connect()
  let stopped = false
  client.on('notification', (message) => {
    if (stopped || message.channel !== 'manila_revocation') return
    onChange()
  })
  client.on('error', () => undefined)
  await client.query('LISTEN manila_revocation')
  return async () => {
    stopped = true
    client.removeAllListeners('notification')
    try {
      await client.query('UNLISTEN manila_revocation')
    } catch {
      // The connection may already be gone; releasing the client is enough.
    }
    client.release()
  }
}

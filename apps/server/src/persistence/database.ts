import { Pool, type PoolClient, type QueryResultRow } from 'pg'

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 10 })
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function queryOne<T extends QueryResultRow>(client: Pool | PoolClient, text: string, values: unknown[] = []): Promise<T | null> {
  const result = await client.query<T>(text, values)
  return result.rows[0] ?? null
}

import { describe, expect, it, vi } from 'vitest'
import { buildServer } from '../server.js'
import type { ServerConfig } from '../config.js'

const config: ServerConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3000,
  databaseUrl: 'postgres://manila:very-secret@localhost/manila',
  migrationsDir: '/does-not-exist',
}

function poolThat(query: () => Promise<unknown>) {
  return {
    query: vi.fn(query),
    end: vi.fn(async () => undefined),
  }
}

describe('health endpoints', () => {
  it('keeps liveness available when storage is down without exposing the URL', async () => {
    const pool = poolThat(async () => {
      throw new Error(`could not connect to ${config.databaseUrl}`)
    })
    const app = buildServer(config, { pool: pool as never })

    await expect(app.inject('/health/live')).resolves.toMatchObject({
      statusCode: 200,
      json: expect.any(Function),
    })
    const ready = await app.inject('/health/ready')

    expect(ready.statusCode).toBe(503)
    expect(ready.json()).toEqual({ code: 'STORAGE_UNAVAILABLE' })
    expect(ready.body).not.toContain(config.databaseUrl)

    await app.close()
    expect(pool.end).toHaveBeenCalledOnce()
  })
})

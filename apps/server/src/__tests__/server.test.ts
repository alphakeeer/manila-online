import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildServer } from '../server.js'
import type { ServerConfig } from '../config.js'

const config: ServerConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3000,
  databaseUrl: 'postgres://manila:very-secret@localhost/manila',
  migrationsDir: '/does-not-exist',
  authPepper: 'test-pepper',
  allowedOrigins: ['http://localhost:5173'],
  secureCookies: false,
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
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

  it('serves the production web build and keeps API 404s as JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manila-web-'))
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root">Manila production shell</div>')
    writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)')
    const pool = poolThat(async () => ({ rows: [] }))
    const app = buildServer({ ...config, webDistDir: root }, { pool: pool as never })
    try {
      const index = await app.inject('/')
      expect(index.statusCode).toBe(200)
      expect(index.body).toContain('Manila production shell')

      const asset = await app.inject('/assets/app-abc123.js')
      expect(asset.statusCode).toBe(200)
      expect(asset.headers['cache-control']).toContain('immutable')

      const spa = await app.inject('/rooms/ABCD2345')
      expect(spa.statusCode).toBe(200)
      expect(spa.body).toContain('Manila production shell')

      const api = await app.inject('/api/not-a-route')
      expect(api.statusCode).toBe(404)
      expect(api.json()).toEqual({ code: 'ROOM_NOT_FOUND' })
    } finally {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

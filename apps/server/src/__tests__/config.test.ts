import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'

describe('loadConfig', () => {
  it('requires a PostgreSQL URL without echoing its value', () => {
    expect(() => loadConfig({ MANILA_ENV: 'development' })).toThrow(
      '缺少必需配置：DATABASE_URL',
    )

    expect(() =>
      loadConfig({ DATABASE_URL: 'mysql://not-postgres' }),
    ).toThrow('DATABASE_URL 必须使用 PostgreSQL 协议')
  })

  it('uses safe local defaults', () => {
    expect(
      loadConfig({ DATABASE_URL: 'postgres://manila:secret@localhost/manila' }),
    ).toMatchObject({
      environment: 'development',
      host: '127.0.0.1',
      port: 3000,
      databaseUrl: 'postgres://manila:secret@localhost/manila',
    })
  })

  it('requires an HTTPS allowlist and a pepper in production', () => {
    expect(() =>
      loadConfig({
        MANILA_ENV: 'production',
        DATABASE_URL: 'postgres://manila:secret@localhost/manila',
      }),
    ).toThrow('AUTH_PEPPER')
    expect(() =>
      loadConfig({
        MANILA_ENV: 'production',
        DATABASE_URL: 'postgres://manila:secret@localhost/manila',
        AUTH_PEPPER: 'secret',
        ALLOWED_ORIGINS: 'http://localhost:5173',
      }),
    ).toThrow('HTTPS')
  })
})

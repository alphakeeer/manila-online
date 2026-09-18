export type ManilaEnvironment = 'development' | 'test' | 'production'

export interface ServerConfig {
  environment: ManilaEnvironment
  host: string
  port: number
  databaseUrl: string
  migrationsDir?: string
  authPepper: string
  allowedOrigins: readonly string[]
  secureCookies: boolean
  sessionTtlMs: number
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`缺少必需配置：${name}`)
  return value
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return 3000
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 的整数')
  return port
}

function isExactHttpsOrigin(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.origin === value
  } catch {
    return false
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawEnvironment = environment.MANILA_ENV ?? 'development'
  if (rawEnvironment !== 'development' && rawEnvironment !== 'test' && rawEnvironment !== 'production') {
    throw new Error('MANILA_ENV 必须是 development、test 或 production')
  }
  const databaseUrl = required(environment, 'DATABASE_URL')
  let database: URL
  try {
    database = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL 必须是有效的 PostgreSQL URL')
  }
  if (database.protocol !== 'postgres:' && database.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL 必须使用 PostgreSQL 协议')
  }
  const authPepper = environment.AUTH_PEPPER?.trim() ?? ''
  const allowedOrigins = (environment.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const isProduction = rawEnvironment === 'production'
  if (isProduction && !authPepper) {
    throw new Error('生产环境必须配置 AUTH_PEPPER')
  }
  if (isProduction && (allowedOrigins.length === 0 || allowedOrigins.some((origin) => !isExactHttpsOrigin(origin)))) {
    throw new Error('生产环境 ALLOWED_ORIGINS 只能包含 HTTPS Origin')
  }
  return {
    environment: rawEnvironment,
    host: environment.HOST?.trim() || '127.0.0.1',
    port: parsePort(environment.PORT),
    databaseUrl,
    authPepper,
    allowedOrigins,
    secureCookies: isProduction,
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  }
}

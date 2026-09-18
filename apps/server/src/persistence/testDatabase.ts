import { Pool } from 'pg'

function databaseName(url: string) {
  const parsed = new URL(url)
  return decodeURIComponent(parsed.pathname).replace(/^\//, '')
}

export function getTestDatabaseUrl(environment = process.env) {
  const databaseUrl = environment.DATABASE_URL
  const testDatabaseUrl = environment.TEST_DATABASE_URL

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL must point to the disposable manila_test database')
  }
  if (databaseName(testDatabaseUrl) !== 'manila_test') {
    throw new Error('TEST_DATABASE_URL database name must be exactly manila_test')
  }
  if (databaseUrl && testDatabaseUrl === databaseUrl) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL')
  }

  return testDatabaseUrl
}

/** This intentionally only resets the explicitly named disposable test database. */
export async function resetTestDatabase(testDatabaseUrl: string) {
  const pool = new Pool({ connectionString: testDatabaseUrl })
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
  } finally {
    await pool.end()
  }
}

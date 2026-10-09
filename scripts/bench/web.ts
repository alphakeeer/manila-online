// Cold-load benchmark of the production build over a throttled "phone 4G" link (4 Mbps down, 100 ms RTT).
// Uses the manila_test database (reset). No compression here; production adds it at Caddy.
import { chromium, devices } from 'playwright'
import { readdirSync, statSync } from 'node:fs'
import { buildServer } from '../../apps/server/src/server.js'
import { createPool } from '../../apps/server/src/persistence/database.js'
import { runMigrations } from '../../apps/server/src/persistence/migrations.js'
import { getTestDatabaseUrl, resetTestDatabase } from '../../apps/server/src/persistence/testDatabase.js'
import { createAccessToken } from '../../apps/server/src/auth/repository.js'
import { digestAccessToken } from '../../apps/server/src/auth/credentials.js'

const databaseUrl = getTestDatabaseUrl()
await resetTestDatabase(databaseUrl)
const pool = createPool(databaseUrl)
await runMigrations(pool, new URL('../../apps/server/migrations/', import.meta.url).pathname)
await createAccessToken(pool, { id: 'token', digest: digestAccessToken('23456789', 'bench-pepper'), label: null })
const dist = new URL('../../dist/', import.meta.url).pathname
const app = buildServer({ environment: 'test', host: '127.0.0.1', port: 0, databaseUrl, authPepper: 'bench-pepper', allowedOrigins: ['http://127.0.0.1'], secureCookies: false, sessionTtlMs: 604_800_000, webDistDir: dist }, { pool })
await app.listen({ host: '127.0.0.1', port: 0 })
const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
const assets = readdirSync(dist + 'assets')
const size = (filter: (name: string) => boolean) => assets.filter(filter).reduce((total, name) => total + statSync(dist + 'assets/' + name).size, 0)
const browser = await chromium.launch()
const runs: Array<Record<string, number>> = []
for (let run = 0; run < 3; run++) {
  const context = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 4_000_000 / 8, uploadThroughput: 1_500_000 / 8 })
  let bytes = 0
  cdp.on('Network.loadingFinished', (event: { encodedDataLength: number }) => { bytes += event.encodedDataLength })
  const t0 = Date.now()
  await page.goto(base)
  await page.getByLabel('访问 Token').waitFor()
  const loginReady = Date.now() - t0
  const loginBytes = bytes
  // Time to bring in everything the game screen needs (images + game chunk), as when a game starts.
  const t1 = Date.now()
  await page.evaluate(async (names) => { await Promise.all(names.map((name) => fetch(`/assets/${name}`, { cache: 'no-store' }).then((response) => response.arrayBuffer()))) }, assets.filter((name) => /\.(png|jpe?g|webp|avif)$/.test(name) || /GameRoom|game/i.test(name)))
  const gameReady = Date.now() - t1
  runs.push({ loginReadyMs: loginReady, loginKB: Math.round(loginBytes / 1024), gameAssetsMs: gameReady })
  await context.close()
}
const median = (key: string) => runs.map((run) => run[key]!).sort((a, b) => a - b)[1]
console.log(JSON.stringify({ jsKB: Math.round(size((name) => name.endsWith('.js')) / 1024), imagesKB: Math.round(size((name) => /\.(png|jpe?g|webp|avif)$/.test(name)) / 1024), loginReadyMs: median('loginReadyMs'), loginTransferKB: median('loginKB'), gameAssetsMs: median('gameAssetsMs') }))
await browser.close(); await app.close(); process.exit(0)

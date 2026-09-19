#!/usr/bin/env node
// Verifies a deployed Manila origin end to end without keeping secrets in logs.
// Usage: PUBLIC_BASE_URL=https://manila.example E2E_ACCESS_TOKEN=XXXXXXXX npm run verify:deployment
import process from 'node:process'
import WebSocket from 'ws'

const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
const token = process.env.E2E_ACCESS_TOKEN
const allowInsecure = process.env.ALLOW_INSECURE === '1'
if (!base) {
  console.error('PUBLIC_BASE_URL is required')
  process.exit(2)
}

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`)
}
const origin = new URL(base).origin

async function fetchText(path, init) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual', ...init })
  return { response, body: await response.text() }
}

try {
  const parsed = new URL(base)
  record('https-origin', parsed.protocol === 'https:' || allowInsecure, `${parsed.protocol}//${parsed.host}${allowInsecure ? ' (ALLOW_INSECURE=1)' : ''}`)
} catch {
  record('https-origin', false, `invalid PUBLIC_BASE_URL: ${base}`)
  process.exit(1)
}

try {
  const live = await fetchText('/health/live')
  record('health-live', live.response.status === 200, `status=${live.response.status}`)
  const ready = await fetchText('/health/ready')
  record('health-ready', ready.response.status === 200, `status=${ready.response.status}`)
  record('health-no-database-url', !/postgres(ql)?:\/\//i.test(ready.body), 'readiness body must not leak DATABASE_URL')

  const index = await fetchText('/')
  const looksLikeSpa = index.response.status === 200 && /<div id="root"/.test(index.body) && /(马尼拉|Manila)/i.test(index.body)
  record('web-shell', looksLikeSpa, `status=${index.response.status}`)
  const assetPath = index.body.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1]
  if (assetPath) {
    const asset = await fetchText(assetPath)
    record('hashed-asset', asset.response.status === 200 && /immutable/.test(asset.response.headers.get('cache-control') ?? ''), assetPath)
  } else {
    record('hashed-asset', false, 'no /assets/ URL found in index.html (production must serve the built shell)')
  }

  const invalidLogin = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ token: 'AAAAAAAA' }),
  })
  const invalidBody = await invalidLogin.text()
  record('invalid-token', invalidLogin.status === 401 && invalidBody.includes('INVALID_ACCESS_TOKEN') && !invalidLogin.headers.has('set-cookie'), `status=${invalidLogin.status}`)

  if (token) {
    const login = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ token }),
    })
    const cookie = login.headers.get('set-cookie') ?? ''
    const loginBody = await login.text()
    const cookieFlags = /HttpOnly/i.test(cookie) && /Secure/i.test(cookie) && /SameSite=Strict/i.test(cookie)
    record('token-login-cookie', login.status === 200 && cookieFlags, `status=${login.status} flags=${cookieFlags}`)
    const sessionCookie = cookie.split(';', 1)[0]
    const lobby = await fetch(`${base}/api/lobby`, { headers: { cookie: sessionCookie } })
    record('authenticated-api', lobby.status === 200, `status=${lobby.status}`)
    const logout = await fetch(`${base}/api/session`, { method: 'DELETE', headers: { cookie: sessionCookie, origin } })
    record('session-logout', logout.status === 204, `status=${logout.status}`)
  } else {
    record('token-login-cookie', false, 'E2E_ACCESS_TOKEN not provided; skipped authenticated checks')
  }

  const wsResult = await new Promise((resolve) => {
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/api/rooms/ZZZZ2222/subscribe`, { origin })
    const timer = setTimeout(() => { socket.terminate(); resolve({ ok: false, detail: 'websocket timeout' }) }, 5000)
    socket.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 1008, detail: `close=${code}` }) })
    socket.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, detail: `error=${error.message}` }) })
  })
  record('wss-rejects-anonymous', wsResult.ok, wsResult.detail)
} catch (error) {
  record('unexpected-error', false, error instanceof Error ? error.message : String(error))
}

const failed = results.filter((result) => !result.ok)
console.log(`deployment verification: ${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)

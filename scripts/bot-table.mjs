#!/usr/bin/env node
// Local demo table: open several real browser windows, one session per seat, and let the
// dev-only random autopilot (?bot=1) play a full game so you can watch the actual UI.
//
//   npm run bots -- --players 4 --phones 1 --delay 1200 --variant strengthened
//
// Needs the local stack: PostgreSQL, `npm run dev:server:relaxed` and `npm run dev`.
import { chromium, devices } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = parseArgs(process.argv.slice(2))
const players = clamp(Number(args.players ?? 3), 3, 5)
const phones = clamp(Number(args.phones ?? 1), 0, players)
const delay = Math.max(200, Number(args.delay ?? 1200))
const baseUrl = String(args.url ?? 'http://localhost:5173').replace(/\/$/, '')
const variant = args.variant === 'strengthened' ? 'strengthened' : 'standard'
const names = ['船长阿青', '丝路老Bo', '玉面小满', '肉蔻王', '人参大叔']

function parseArgs(list) {
  const parsed = {}
  for (let index = 0; index < list.length; index += 1) {
    const key = list[index]
    if (!key.startsWith('--')) continue
    const value = list[index + 1] && !list[index + 1].startsWith('--') ? list[++index] : 'true'
    parsed[key.slice(2)] = value
  }
  return parsed
}
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min }
const log = (message) => console.log(`[bots] ${message}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (args.help) {
  console.log('用法：npm run bots -- [--players 3-5] [--phones 0-N] [--delay 毫秒] [--variant standard|strengthened] [--url http://localhost:5173] [--token XXXXXXXX] [--exit]')
  process.exit(0)
}

async function ensureStack() {
  try {
    const response = await fetch(`${baseUrl}/api/session`)
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    console.error(`[bots] 无法访问 ${baseUrl}/api（${error.message}）。请先启动本地环境：\n  docker compose up -d postgres\n  npm run db:migrate\n  npm run dev:server:relaxed   # 另开终端\n  npm run dev                  # 另开终端`)
    process.exit(1)
  }
}

function accessToken() {
  const given = args.token ?? process.env.MANILA_TOKEN ?? process.env.E2E_ACCESS_TOKEN
  if (given) return String(given)
  const result = spawnSync('npm', ['run', '--silent', 'tokens', '--', 'create', 'bot-table'], { cwd: root, encoding: 'utf8' })
  const token = `${result.stdout}`.match(/Token:\s*([23456789A-HJ-NP-Z]{8})/)?.[1]
  if (!token) {
    console.error(`[bots] 自动创建本地 Token 失败，可用 --token 指定。\n${result.stderr || result.stdout}`)
    process.exit(1)
  }
  log('已在本地数据库创建标签为 bot-table 的测试 Token')
  return token
}

async function tile(browser, pages, phoneFlags) {
  const screen = await pages[0].evaluate(() => ({ x: window.screen.availLeft ?? 0, y: window.screen.availTop ?? 0, w: window.screen.availWidth, h: window.screen.availHeight }))
  const phoneWidth = 430
  const desktopCount = phoneFlags.filter((flag) => !flag).length
  const desktopWidth = desktopCount > 0 ? Math.max(520, Math.floor((screen.w - phoneWidth * (pages.length - desktopCount)) / desktopCount)) : 0
  let left = screen.x
  for (const [index, page] of pages.entries()) {
    const width = phoneFlags[index] ? phoneWidth : desktopWidth
    try {
      const session = await page.context().newCDPSession(page)
      const { windowId } = await session.send('Browser.getWindowForTarget')
      await session.send('Browser.setWindowBounds', { windowId, bounds: { left: Math.min(left, screen.x + screen.w - 200), top: screen.y, width, height: screen.h, windowState: 'normal' } })
    } catch { /* tiling is cosmetic */ }
    left += width
  }
}

async function login(page, token, label) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${baseUrl}/?bot=1&botDelay=${delay}`)
    await page.getByLabel('访问 Token').fill(token)
    await page.getByRole('button', { name: '进入大厅' }).click()
    const entered = page.getByRole('heading', { name: '创建或加入房间' })
    const limited = page.getByText('操作过于频繁')
    await Promise.race([entered.waitFor({ timeout: 15_000 }), limited.waitFor({ timeout: 15_000 })]).catch(() => undefined)
    if (await entered.isVisible()) return
    log(`${label} 登录被限流；建议用 npm run dev:server:relaxed 启动服务。等待 60 秒后重试…`)
    await sleep(61_000)
  }
  throw new Error(`${label} 无法登录`)
}

async function ready(page, code) {
  await page.reload()
  await page.getByRole('heading', { name: `房间 ${code}` }).waitFor()
  await page.getByRole('button', { name: '准备' }).click()
  await page.getByRole('button', { name: '取消准备' }).waitFor()
}

await ensureStack()
const token = accessToken()
const browser = await chromium.launch({ headless: false, args: ['--disable-features=Translate', '--autoplay-policy=no-user-gesture-required'] })
browser.on('disconnected', () => { log('浏览器已关闭'); process.exit(0) })
const phoneFlags = Array.from({ length: players }, (_, index) => index >= players - phones)
const contexts = await Promise.all(phoneFlags.map((phone) => browser.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: null })))
const pages = await Promise.all(contexts.map((context) => context.newPage()))
await pages[0].goto(baseUrl)
await tile(browser, pages, phoneFlags)

log(`${players} 个座位（${phones} 个手机窗口），机器人思考约 ${delay} ms，海盗规则：${variant === 'standard' ? '标准' : '加强'}`)
for (const [index, page] of pages.entries()) await login(page, token, names[index])

const host = pages[0]
await host.getByLabel('昵称').fill(names[0])
if (variant === 'strengthened') await host.getByText('加强海盗').click()
await host.getByRole('button', { name: '创建房间' }).click()
const title = await host.getByRole('heading', { name: /房间 / }).textContent()
const code = title?.match(/[23456789A-HJ-NP-Z]{8}/)?.[0]
if (!code) throw new Error('没有读到房间码')
log(`房间 ${code} 已创建`)
for (const [index, page] of pages.slice(1).entries()) {
  await page.getByLabel('昵称').fill(names[index + 1])
  await page.getByLabel('房间码').fill(code)
  await page.getByRole('button', { name: '加入房间' }).click()
  await page.getByRole('heading', { name: `房间 ${code}` }).waitFor()
}
for (const page of pages) await ready(page, code)
await host.reload()
await host.getByRole('button', { name: '开始竞拍' }).click({ timeout: 15_000 })
await Promise.all(pages.map((page) => page.locator('.game-shell').waitFor({ timeout: 15_000 })))
log('开局！机器人开始随机决策（每个窗口右上角可暂停托管，接手亲自操作）')

let lastPhase = ''
const started = Date.now()
while (true) {
  if (await host.locator('.standings').count().catch(() => 0) > 0) break
  const phase = await host.locator('.phase-track').getAttribute('aria-label').catch(() => null)
  if (phase && phase !== lastPhase) { lastPhase = phase; log(phase) }
  const errors = await Promise.all(pages.map((page) => page.locator('.rule-error').textContent().catch(() => null)))
  errors.forEach((text, index) => { if (text) log(`${names[index]} 提示：${text.replace('×', '').trim()}`) })
  await sleep(2000)
}
await sleep(3000) // let the podium count-up settle
const standings = await host.evaluate(() => [...document.querySelectorAll('.podium-stage__spot')]
  .map((spot) => ({ rank: Number(spot.querySelector('.podium-stage__pillar')?.textContent), name: spot.querySelector('.podium-stage__name')?.textContent?.replace('（你）', ''), wealth: spot.querySelector('.podium-stage__wealth')?.textContent?.trim() }))
  .concat([...document.querySelectorAll('.podium-rest li')].map((row, index) => ({ rank: index + 4, name: row.querySelector('strong')?.textContent, wealth: `${row.querySelector('b')?.textContent} 比索` })))
  .sort((left, right) => left.rank - right.rank)).catch(() => [])
log(`终局（用时 ${Math.round((Date.now() - started) / 1000)} 秒）：${standings.map((row) => `#${row.rank} ${row.name} ${row.wealth}`).join('  ')}`)
if (args.exit) { await browser.close(); process.exit(0) }
log('窗口保持打开，可以查看结算画面；按 Ctrl+C 结束。')
process.on('SIGINT', async () => { await browser.close().catch(() => undefined); process.exit(0) })
await new Promise(() => undefined)

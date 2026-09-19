import { expect, test, type Page } from '@playwright/test'

const token = process.env.E2E_ACCESS_TOKEN
const enabled = Boolean(process.env.PLAYWRIGHT_BASE_URL && token && process.env.E2E_FULL_GAME === '1')

async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel('访问 Token').fill(token ?? '')
  await page.getByRole('button', { name: '进入大厅' }).click()
  await expect(page.getByRole('heading', { name: '创建或加入房间' })).toBeVisible()
}

async function createTable(pages: Page[]) {
  await Promise.all(pages.map(login))
  await pages[0]!.getByLabel('昵称').fill('Host')
  await pages[0]!.getByRole('button', { name: '创建房间' }).click()
  const title = await pages[0]!.getByRole('heading', { name: /房间 / }).textContent()
  const roomCode = title?.match(/[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}/)?.[0]
  if (!roomCode) throw new Error('missing room code')
  for (const [index, page] of pages.slice(1).entries()) {
    await page.getByLabel('昵称').fill(`P${index + 2}`)
    await page.getByLabel('房间码').fill(roomCode)
    await page.getByRole('button', { name: '加入房间' }).click()
    await expect(page.getByRole('heading', { name: `房间 ${roomCode}` })).toBeVisible()
  }
  for (const page of pages) {
    await page.reload()
    await expect(page.getByRole('heading', { name: `房间 ${roomCode}` })).toBeVisible()
    const ready = page.getByRole('button', { name: '准备' })
    await expect(ready).toBeEnabled()
    await ready.click()
    await expect(page.getByRole('button', { name: '取消准备' })).toBeVisible()
  }
  await pages[0]!.getByRole('button', { name: '开始竞拍' }).click()
  await expect.poll(async () => (await Promise.all(pages.map((page) => page.locator('.game-shell').count()))).reduce((total, count) => total + count, 0), { timeout: 10_000 }).toBe(pages.length)
}

async function act(page: Page): Promise<boolean> {
  if (await page.locator('aside[aria-label="竞拍操作"]').count() > 0) {
    await page.getByRole('button', { name: '放弃本轮竞拍' }).click()
    return true
  }
  const purchase = page.locator('aside[aria-label="购股操作"]')
  if (await purchase.count() > 0) {
    await purchase.getByRole('button', { name: '跳过购股' }).click()
    return true
  }
  const cargo = page.locator('aside[aria-label="选货操作"]')
  if (await cargo.count() > 0) {
    const boxes = cargo.locator('input[type="checkbox"]')
    for (let index = 0; index < 3; index += 1) await boxes.nth(index).check()
    await cargo.getByRole('button', { name: '确认三种货物' }).click()
    return true
  }
  const launch = page.locator('aside[aria-label="下水操作"]')
  if (await launch.count() > 0) {
    await launch.getByRole('button', { name: '确认下水' }).click()
    return true
  }
  const placement = page.locator('aside[aria-label="放置同伙"]')
  if (await placement.count() > 0) {
    const options = placement.locator('.option-list button')
    if (await options.count() > 0) {
      await options.first().click()
      const confirm = placement.getByRole('button', { name: '确认放置' })
      if (await confirm.isEnabled()) await confirm.click()
      else {
        await placement.getByRole('button', { name: '重新选择' }).click()
        await placement.getByRole('button', { name: '放弃放置' }).click()
      }
    } else {
      await placement.getByRole('button', { name: '放弃放置' }).click()
    }
    return true
  }
  const movement = page.locator('aside[aria-label="移动舢板"]')
  if (await movement.count() > 0) {
    await movement.getByRole('button').first().click()
    return true
  }
  const pilot = page.locator('aside[aria-label="领航操作"]')
  if (await pilot.count() > 0) {
    const stay = pilot.getByRole('button', { name: '不移动' })
    if (await stay.count() > 0) await stay.click()
    else await pilot.getByRole('button').first().click()
    return true
  }
  const pirate = page.locator('aside[aria-label="海盗登船"]')
  if (await pirate.count() > 0) {
    await pirate.getByRole('button', { name: '留在海盗船' }).click()
    return true
  }
  const plunder = page.locator('aside[aria-label="劫掠去向"]')
  if (await plunder.count() > 0) {
    await plunder.getByRole('button', { name: '送往港口' }).click()
    return true
  }
  return false
}

test.describe('complete browser game', () => {
  test.skip(!enabled, 'set E2E_FULL_GAME=1 together with E2E_ACCESS_TOKEN and PLAYWRIGHT_BASE_URL')

  test('three isolated browsers play through to final standings', async ({ browser }) => {
    test.slow()
    const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
    const pages = await Promise.all(contexts.map((context) => context.newPage()))
    try {
      await createTable(pages)
      const revisionOf = async (page: Page) => Number(await page.locator('.game-shell').getAttribute('data-room-revision') ?? -1)
      const deadline = Date.now() + 150_000
      while (Date.now() < deadline) {
        if (await pages[0]!.locator('.standings').count() > 0) break
        const revisions = await Promise.all(pages.map(revisionOf))
        const newest = Math.max(...revisions)
        let acted = false
        for (const [index, page] of pages.entries()) {
          if (revisions[index] !== newest) continue
          if (await page.locator('aside.decision-panel', { hasText: '等待行动' }).count() > 0) continue
          if (await act(page)) {
            await expect.poll(() => revisionOf(page), { timeout: 5_000 }).toBeGreaterThan(newest)
            acted = true
            break
          }
        }
        if (!acted) await pages[0]!.waitForTimeout(150)
      }
      for (const page of pages) {
        await expect(page.locator('.standings')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByText('最终排名')).toBeVisible()
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })
})

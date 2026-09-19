import { expect, test } from '@playwright/test'

const token = process.env.E2E_ACCESS_TOKEN
const enabled = Boolean(process.env.PLAYWRIGHT_BASE_URL && token)

async function login(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel('访问 Token').fill(token ?? '')
  await page.getByRole('button', { name: '进入大厅' }).click()
  await expect(page.getByRole('heading', { name: '创建或加入房间' })).toBeVisible()
}

test.describe('authoritative auction', () => {
  test.skip(!enabled, 'requires a running app plus E2E_ACCESS_TOKEN from the host CLI')

  test('three isolated browsers create, prepare, start, and synchronise the first bid', async ({ browser }) => {
    const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
    const pages = await Promise.all(contexts.map((context) => context.newPage()))
    try {
      await Promise.all(pages.map(login))
      await pages[0].getByLabel('昵称').fill('Host')
      await pages[0].getByRole('button', { name: '创建房间' }).click()
      const title = await pages[0].getByRole('heading', { name: /房间 / }).textContent()
      const roomCode = title?.match(/[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}/)?.[0]
      expect(roomCode).toBeTruthy()
      for (const [page, nickname] of [[pages[1], 'One'], [pages[2], 'Two']] as const) {
        await page.getByLabel('昵称').fill(nickname)
        await page.getByLabel('房间码').fill(roomCode!)
        await page.getByRole('button', { name: '加入房间' }).click()
        await expect(page.getByRole('heading', { name: `房间 ${roomCode}` })).toBeVisible()
      }
      for (const page of pages) {
        await page.reload()
        await expect(page.getByRole('heading', { name: `房间 ${roomCode}` })).toBeVisible()
        await page.getByRole('button', { name: '准备' }).click()
        await expect(page.getByRole('button', { name: '取消准备' })).toBeVisible()
      }
      await pages[0].reload()
      await expect(pages[0].getByRole('button', { name: '开始竞拍' })).toBeEnabled()
      await pages[0].getByRole('button', { name: '开始竞拍' }).click()
      await expect.poll(async () => (await Promise.all(pages.map((page) => page.locator('.game-shell').count()))).reduce((total, count) => total + count, 0), { timeout: 8_000 }).toBe(3)
      const acting = await Promise.all(pages.map(async (page) => ({ page, active: await page.getByText('你的回合').count() })))
      const actor = acting.find((entry) => entry.active === 1)?.page
      expect(actor).toBeTruthy()
      await actor!.getByRole('button', { name: '确认出价' }).click()
      await expect.poll(async () => (await Promise.all(pages.map((page) => page.getByText('你的回合').count()))).reduce((total, count) => total + count, 0), { timeout: 8_000 }).toBe(1)
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })
})

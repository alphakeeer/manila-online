import { expect, test } from '@playwright/test'

const token = process.env.E2E_ACCESS_TOKEN
const enabled = Boolean(process.env.PLAYWRIGHT_BASE_URL && token)

test.describe('session gate', () => {
  test.skip(!enabled, 'requires a running app plus E2E_ACCESS_TOKEN from the host CLI')

  test('two isolated browsers receive separate refreshable sessions and logout clears one', async ({ browser }) => {
    const first = await browser.newContext()
    const second = await browser.newContext()
    const firstPage = await first.newPage()
    const secondPage = await second.newPage()
    try {
      for (const page of [firstPage, secondPage]) {
        await page.goto('/')
        await page.getByLabel('访问 Token').fill(token ?? '')
        await page.getByRole('button', { name: '进入大厅' }).click()
        await expect(page.getByRole('heading', { name: '创建或加入房间' })).toBeVisible()
      }
      expect(await first.cookies()).not.toEqual(await second.cookies())

      await firstPage.reload()
      await expect(firstPage.getByRole('heading', { name: '创建或加入房间' })).toBeVisible()
      await firstPage.getByRole('button', { name: '退出' }).click()
      await expect(firstPage.getByRole('button', { name: '进入大厅' })).toBeVisible()
      await secondPage.reload()
      await expect(secondPage.getByRole('heading', { name: '创建或加入房间' })).toBeVisible()
    } finally {
      await first.close()
      await second.close()
    }
  })
})

import { readFileSync, statSync } from 'node:fs'
import { expect, test } from 'vitest'

const boardSource = readFileSync(new URL('../GameBoard.tsx', import.meta.url), 'utf8')
const shipped = ['game_board.webp', 'nutmeg_shares.webp', 'silk_shares.webp', 'jade_shares.webp', 'ginseng_shares.webp']

test('ships only explicit, compressed board assets within a phone-friendly budget', () => {
  expect(boardSource).not.toContain('import.meta.glob')
  let total = 0
  for (const name of shipped) {
    expect(boardSource).toContain(`'../assets/${name}'`)
    total += statSync(new URL(`../../assets/${name}`, import.meta.url)).size
  }
  // 1.73 MB of JPEG/PNG became ~340 KB of WebP; keep it there.
  expect(total).toBeLessThanOrEqual(600 * 1024)
})

test('never bundles the archival originals in manila_assets', () => {
  expect(boardSource).not.toMatch(/new URL\('[^']*manila_assets\//)
})

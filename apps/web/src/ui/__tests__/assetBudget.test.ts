import { readFileSync, statSync } from 'node:fs'
import { expect, test } from 'vitest'

const boardSource = readFileSync(new URL('../GameBoard.tsx', import.meta.url), 'utf8')
const sourcePaths = [
  '../../../../manila_assets/game_board.jpg',
  '../../../../manila_assets/nutmeg_shares.png',
  '../../../../manila_assets/silk_shares.png',
  '../../../../manila_assets/jade_shares.png',
  '../../../../manila_assets/ginseng_shares.png',
]
const testFilePaths = sourcePaths.map((asset) => asset.replace('../../../../', '../../../../../'))

test('loads only explicit, budgeted board assets instead of globbing archival originals', () => {
  expect(boardSource).not.toContain('import.meta.glob')
  let total = 0
  for (const [index, asset] of sourcePaths.entries()) {
    expect(boardSource).toContain(asset)
    total += statSync(new URL(testFilePaths[index]!, import.meta.url)).size
  }
  expect(total).toBeLessThanOrEqual(5 * 1024 * 1024)
})

test('keeps the large single-player source art out of the production board imports', () => {
  for (const heavy of ['nutmeg.png', 'silk.png', 'jade.png', 'ginseng.png', 'player_blue.png', 'player_green.png']) {
    expect(boardSource).not.toContain(`manila_assets/${heavy}`)
  }
})

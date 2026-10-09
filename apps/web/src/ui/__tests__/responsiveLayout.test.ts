import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const stylesheet = readFileSync(new URL('../manila.css', import.meta.url), 'utf8')
const mobileStyles = stylesheet.split('@media (max-width: 899px) {')[1]?.split('@media (max-width: 360px) {')[0] ?? ''

test('docks decisions in a collapsible bottom sheet on phones that respects the safe area', () => {
  expect(mobileStyles).toMatch(/\.action-dock\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0[^}]*max-height:/)
  expect(mobileStyles).toMatch(/\.action-dock\s*\{[^}]*env\(safe-area-inset-bottom\)/)
  expect(mobileStyles).toMatch(/\.action-dock:not\(\.is-open\)\s*\{[^}]*max-height:\s*\d+px/)
})

test('keeps the decision panel itself in document flow inside the sheet', () => {
  expect(mobileStyles).toMatch(/\.decision-panel\s*\{[^}]*position:\s*static/)
})

test('reserves scroll room under the board so the sheet never hides content permanently', () => {
  expect(mobileStyles).toMatch(/\.game-shell\s*\{[^}]*padding:[^;]*calc\(\d+px \+ env\(safe-area-inset-bottom\)\)/)
  expect(mobileStyles).toMatch(/\.board-stage\s*\{[^}]*width:\s*100%/)
})

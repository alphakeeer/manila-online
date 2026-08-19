import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const stylesheet = readFileSync(new URL('../manila-demo.css', import.meta.url), 'utf8')
const mobileStyles = stylesheet.split('@media (max-width: 899px) {')[1]?.split('@media (max-width: 360px) {')[0] ?? ''

test('keeps the decision panel in document flow below the board on mobile', () => {
  expect(mobileStyles).toMatch(/\.decision-panel\s*\{[^}]*position:\s*static/)
  expect(mobileStyles).not.toMatch(/\.decision-panel\s*\{[^}]*position:\s*fixed/)
})

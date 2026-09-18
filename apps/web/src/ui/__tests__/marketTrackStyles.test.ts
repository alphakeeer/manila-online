import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('uses a restrained rectangular marker highlight instead of a circular token', async () => {
  const css = await readFile(new URL('../manila.css', import.meta.url), 'utf8')

  expect(css).toMatch(/\.market-marker \{[^}]*border-radius: 4px/s)
  expect(css).not.toMatch(/\.market-marker \{[^}]*border-radius: 50%/s)
  expect(css).toMatch(/\.market-marker \{[^}]*box-shadow:[^;]*0 0 10px 2px/s)
})

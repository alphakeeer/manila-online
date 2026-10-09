import { describe, expect, test } from 'vitest'
import { annotationDocument, findBoardPosition } from '../annotations'

const middle = annotationDocument.board.width / 2
const position = (name: string) => findBoardPosition(annotationDocument, name)

describe('berth annotations follow the printed board letters', () => {
  test('port berths sit on the left dock with A at the bottom and C at the top, as printed', () => {
    for (const berth of ['a', 'b', 'c']) {
      expect(position(`port-${berth}-punt-slot`).x).toBeLessThan(middle)
      expect(position(`port-${berth}-accomplice-slot`).x).toBeLessThan(middle)
    }
    expect(position('port-a-punt-slot').y).toBeGreaterThan(position('port-b-punt-slot').y)
    expect(position('port-b-punt-slot').y).toBeGreaterThan(position('port-c-punt-slot').y)
    expect(position('port-a-accomplice-slot').y).toBeGreaterThan(position('port-c-accomplice-slot').y)
  })

  test('shipyard berths and their crew slots sit on the right dock with A at the top', () => {
    for (const berth of ['a', 'b', 'c']) {
      expect(position(`shipyard-${berth}-punt-slot`).x).toBeGreaterThan(middle)
      expect(position(`shipyard-${berth}-accomplice-slot`).x).toBeGreaterThan(middle)
    }
    expect(position('shipyard-a-accomplice-slot').y).toBeLessThan(position('shipyard-b-accomplice-slot').y)
    expect(position('shipyard-b-accomplice-slot').y).toBeLessThan(position('shipyard-c-accomplice-slot').y)
  })

  test('each crew slot is beside its own berth', () => {
    for (const area of ['port', 'shipyard']) {
      for (const berth of ['a', 'b', 'c']) {
        expect(Math.abs(position(`${area}-${berth}-accomplice-slot`).y - position(`${area}-${berth}-punt-slot`).y)).toBeLessThan(80)
      }
    }
  })
})

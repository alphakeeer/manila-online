import { describe, expect, test } from 'vitest'
import { annotationDocument, findBoardPosition, findCargoSlotPosition, playerPositionStyle, positionStyle } from '../annotations'

describe('board annotation adapter', () => {
  test('converts an annotated source coordinate into responsive CSS positioning', () => {
    const position = findBoardPosition(annotationDocument, 'left-route-space-0')

    expect(position).toMatchObject({ name: 'left-route-space-0', x: 198.74, y: 1866.36, rotation: 0, scale: 0.54 })
    expect(positionStyle(annotationDocument.board, position)).toEqual({
      left: '19.05465004793864%',
      top: '91.130859375%',
      transform: 'translate(-50%, -50%) rotate(0deg) scale(0.54)',
    })
  })

  test('finds semantic positions instead of exposing component coordinates', () => {
    const position = findBoardPosition(annotationDocument, 'insurance-office-accomplice-slot')

    expect(position.name).toBe('insurance-office-accomplice-slot')
    expect(position.x).toBeGreaterThan(0)
    expect(position.y).toBeGreaterThan(0)
  })

  test('reports a missing semantic board position clearly', () => {
    expect(() => findBoardPosition(annotationDocument, 'not-a-real-slot')).toThrow('缺少版图标注：not-a-real-slot')
  })

  test('resolves cargo accomplice slots from the share canvas semantic names', () => {
    expect(findCargoSlotPosition(annotationDocument, 'jade', 3).name).toBe('jade-cargo-slot-cost-5b')
    expect(findCargoSlotPosition(annotationDocument, 'ginseng', 0).name).toBe('ginseng-cargo-slot-cost-1')
  })

  test('keeps player sprites visible by not reapplying the annotator sprite scale', () => {
    const slot = findCargoSlotPosition(annotationDocument, 'nutmeg', 0)
    const style = playerPositionStyle(annotationDocument.shares[1]!, slot)

    expect(style.transform).toBe('translate(-50%, -50%) rotate(0deg)')
    expect(style.left).toBe('54.08597285067873%')
    expect(style.width).toBe('45.39366515837104%')
  })

  test('scales a player relative to the board canvas rather than 42% of the board', () => {
    const boardSlot = findBoardPosition(annotationDocument, 'insurance-office-accomplice-slot')
    const style = playerPositionStyle(annotationDocument.board, boardSlot)

    expect(Number.parseFloat(style.width as string)).toBeLessThan(12)
  })
})

import { describe, expect, test } from 'vitest'
import { commodityPresentation } from '../commodityPresentation'

describe('commodity presentation', () => {
  test('assigns the silk label its semantic colour class', () => {
    expect(commodityPresentation('silk')).toEqual({ label: '丝绸', className: 'commodity--silk' })
  })

  test('assigns every commodity a distinct semantic class', () => {
    expect(new Set(['nutmeg', 'silk', 'jade', 'ginseng'].map((commodity) => commodityPresentation(commodity as 'nutmeg' | 'silk' | 'jade' | 'ginseng').className)).size).toBe(4)
  })
})

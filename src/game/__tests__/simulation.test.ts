import { describe, expect, test } from 'vitest'
import { runAcceptanceSimulation } from '../simulation'

describe('random AI acceptance simulation', () => {
  test('completes ten seeded three-player games without invariant violations', () => {
    const results = runAcceptanceSimulation()

    expect(results).toHaveLength(10)
    expect(results.map((result) => result.pirateVariant)).toEqual([
      'standard',
      'strengthened',
      'standard',
      'strengthened',
      'standard',
      'strengthened',
      'standard',
      'strengthened',
      'standard',
      'strengthened',
    ])
    for (const result of results) {
      expect(result.voyages).toBeGreaterThan(0)
      expect(result.voyages).toBeLessThanOrEqual(500)
      expect(result.standings).toHaveLength(3)
      expect(result.standings.some((standing) => standing.winner)).toBe(true)
      expect(result.transitions).toBeGreaterThan(0)
    }
  })
})

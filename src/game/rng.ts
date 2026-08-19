import type { RngState } from './types'

export function createRng(seed: number): RngState {
  return { algorithm: 'mulberry32-v1', value: seed >>> 0 }
}

export function nextRandom(rng: RngState): [number, RngState] {
  const value = (rng.value + 0x6d2b79f5) >>> 0
  let mixed = value
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
  const random = ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  return [random, { ...rng, value }]
}

export function randomInt(rng: RngState, maximumExclusive: number): [number, RngState] {
  const [random, next] = nextRandom(rng)
  return [Math.floor(random * maximumExclusive), next]
}

export function shuffle<T>(values: readonly T[], rng: RngState): [T[], RngState] {
  const result = [...values]
  let next = rng
  for (let index = result.length - 1; index > 0; index -= 1) {
    const [swapIndex, following] = randomInt(next, index + 1)
    next = following
    const current = result[index]
    const other = result[swapIndex]
    if (current !== undefined && other !== undefined) {
      result[index] = other
      result[swapIndex] = current
    }
  }
  return [result, next]
}


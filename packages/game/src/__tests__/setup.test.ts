import { describe, expect, test } from 'vitest'
import { COMMODITIES, createGame, validateState } from '../index'

const threePlayers = [
  { id: 'p1', name: '阿青' },
  { id: 'p2', name: '阿明' },
  { id: 'p3', name: '阿兰' },
]

describe('createGame', () => {
  test('rejects a player count outside 3–5', () => {
    const result = createGame({
      players: threePlayers.slice(0, 2),
      startingPlayerId: 'p1',
      seed: 1,
      pirateVariant: 'standard',
    })

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_PLAYER_COUNT', message: '玩家人数必须为 3–5 人' },
    })
  })

  test('deals two shares and four accomplices to each player in a three-player game', () => {
    const result = createGame({
      players: threePlayers,
      startingPlayerId: 'p1',
      seed: 20260819,
      pirateVariant: 'standard',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.players.map((player) => ({
      pesos: player.pesos,
      shares: player.shares.length,
      accomplices: player.accompliceTotal,
    }))).toEqual([
      { pesos: 30, shares: 2, accomplices: 4 },
      { pesos: 30, shares: 2, accomplices: 4 },
      { pesos: 30, shares: 2, accomplices: 4 },
    ])
    expect(result.value.phase.kind).toBe('auction')
    expect(result.value.market).toEqual({ nutmeg: 0, silk: 0, jade: 0, ginseng: 0 })

    for (const commodity of COMMODITIES) {
      const owned = result.value.players.flatMap((player) => player.shares)
        .filter((share) => share.commodity === commodity).length
      const available = result.value.shareSupply.filter((share) => share.commodity === commodity).length
      expect(owned + available).toBe(5)
    }
    expect(validateState(result.value)).toEqual([])
  })

  test('repeats the same deal for the same seed', () => {
    const config = {
      players: threePlayers,
      startingPlayerId: 'p1',
      seed: 99,
      pirateVariant: 'strengthened' as const,
    }

    const first = createGame(config)
    const second = createGame(config)
    expect(first).toEqual(second)
  })

  test('reports inconsistent berth and cargo-slot state', () => {
    const result = createGame({
      players: threePlayers,
      startingPlayerId: 'p1',
      seed: 17,
      pirateVariant: 'standard',
    })
    if (!result.ok) throw new Error(result.error.message)
    const state = result.value
    state.boats[0]!.commodity = 'ginseng'
    state.boats[0]!.status = 'port'
    state.boats[0]!.berth = 'A'
    state.portBerths.A = 'boat-2'
    state.accomplices[0]!.location = { area: 'cargo', boatId: 'boat-1', slot: 99 }

    expect(validateState(state).map((violation) => violation.code)).toEqual(expect.arrayContaining([
      'BERTH_MISMATCH',
      'INVALID_CARGO_SLOT',
    ]))
  })
})

import { describe, expect, test } from 'vitest'
import {
  createGame,
  getDecision,
  getStandings,
  transition,
  type GameAction,
  type GameState,
} from '../index'

const players = [
  { id: 'p1', name: '一号' },
  { id: 'p2', name: '二号' },
  { id: 'p3', name: '三号' },
]

function fresh(variant: 'standard' | 'strengthened' = 'standard'): GameState {
  const result = createGame({ players, startingPlayerId: 'p1', seed: 31, pirateVariant: variant })
  if (!result.ok) throw new Error(result.error.message)
  const state = result.value
  state.harborMasterId = 'p1'
  state.selectedCommodities = ['nutmeg', 'silk', 'jade']
  state.boats.forEach((boat, index) => {
    boat.commodity = state.selectedCommodities[index] ?? null
    boat.lane = index as 0 | 1 | 2
    boat.startPosition = [4, 3, 2][index] ?? 0
    boat.position = boat.startPosition
    boat.status = 'sailing'
  })
  return state
}

function act(state: GameState, action: GameAction): GameState {
  const result = transition(state, action)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value.state
}

describe('movement and pilots', () => {
  test('uses the harbor master movement order to assign the first port berth', () => {
    let state = fresh()
    state.boats[0]!.position = 12
    state.boats[1]!.position = 12
    state.phase = {
      kind: 'movementOrder',
      playerId: 'p1',
      movementRound: 1,
      dice: { nutmeg: 2, silk: 3, jade: 1, ginseng: 6 },
      remainingBoatIds: ['boat-1', 'boat-2', 'boat-3'],
      movedBoatIds: [],
    }

    state = act(state, { type: 'moveBoat', playerId: 'p1', boatId: 'boat-2' })
    state = act(state, { type: 'moveBoat', playerId: 'p1', boatId: 'boat-1' })

    expect(state.boats[1]).toMatchObject({ status: 'port', berth: 'A' })
    expect(state.boats[0]).toMatchObject({ status: 'port', berth: 'B' })
  })

  test('lets the small pilot cross 13 into port but rejects a move below zero', () => {
    let state = fresh()
    state.boats[0]!.position = 13
    state.boats[1]!.position = 0
    const pilot = state.accomplices[0]!
    pilot.location = { area: 'smallPilot' }
    state.phase = { kind: 'smallPilot', playerId: pilot.playerId }

    const invalid = transition(state, {
      type: 'pilotMove',
      playerId: pilot.playerId,
      moves: [{ boatId: 'boat-2', delta: -1 }],
    })
    expect(invalid).toMatchObject({ ok: false, error: { code: 'PILOT_OUT_OF_BOUNDS' } })

    state = act(state, {
      type: 'pilotMove',
      playerId: pilot.playerId,
      moves: [{ boatId: 'boat-1', delta: 1 }],
    })
    expect(state.boats[0]).toMatchObject({ status: 'port', berth: 'A' })
  })
})

describe('pirates', () => {
  test('does not offer displacement while an eligible punt still has an empty slot', () => {
    const state = fresh('strengthened')
    const pirate = state.accomplices[0]!
    pirate.location = { area: 'pirateCaptain' }
    state.accomplices[1]!.location = { area: 'cargo', boatId: 'boat-1', slot: 0 }
    state.phase = { kind: 'pirateBoarding', accompliceId: pirate.id, eligibleBoatIds: ['boat-1'] }

    expect(getDecision(state)).toMatchObject({
      kind: 'pirateBoarding',
      displaceableByBoat: { 'boat-1': [] },
    })
  })

  test('does not let a standard pirate board a full punt', () => {
    const state = fresh('standard')
    const pirate = state.accomplices[0]!
    pirate.location = { area: 'pirateCaptain' }
    for (let slot = 0; slot < 3; slot += 1) {
      state.accomplices[slot + 1]!.location = { area: 'cargo', boatId: 'boat-1', slot }
    }
    state.phase = { kind: 'pirateBoarding', accompliceId: pirate.id, eligibleBoatIds: [] }

    const result = transition(state, {
      type: 'boardPirate',
      playerId: pirate.playerId,
      accompliceId: pirate.id,
      boatId: 'boat-1',
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'PIRATE_TARGET_INELIGIBLE' } })
  })

  test('lets a strengthened pirate displace an occupant when every target is full', () => {
    let state = fresh('strengthened')
    state.boats[0]!.position = 13
    const pirate = state.accomplices[0]!
    pirate.location = { area: 'pirateCaptain' }
    for (let slot = 0; slot < 3; slot += 1) {
      state.accomplices[slot + 1]!.location = { area: 'cargo', boatId: 'boat-1', slot }
    }
    const displaced = state.accomplices[1]!
    state.phase = { kind: 'pirateBoarding', accompliceId: pirate.id, eligibleBoatIds: ['boat-1'] }

    state = act(state, {
      type: 'boardPirate',
      playerId: pirate.playerId,
      accompliceId: pirate.id,
      boatId: 'boat-1',
      displacedAccompliceId: displaced.id,
    })

    expect(displaced.id).toBeTruthy()
    expect(state.accomplices.find((token) => token.id === displaced.id)?.location).toBeNull()
    expect(state.accomplices.find((token) => token.id === pirate.id)?.location).toEqual({ area: 'cargo', boatId: 'boat-1', slot: 0 })
  })
})

describe('profit distribution and game end', () => {
  test('pays cargo and berth profits before the insurance agent covers repairs', () => {
    let state = fresh()
    state.players[0]!.pesos = 0
    state.players[1]!.pesos = 0
    state.players[2]!.pesos = 40
    state.boats[0]!.commodity = 'ginseng'
    state.boats[0]!.position = 12
    state.boats[1]!.position = 0
    state.boats[2]!.position = 0
    state.accomplices[0]!.location = { area: 'cargo', boatId: 'boat-1', slot: 0 }
    state.accomplices[4]!.location = { area: 'port', berth: 'A' }
    state.accomplices[5]!.location = { area: 'shipyard', berth: 'A' }
    state.accomplices[8]!.location = { area: 'insurance' }
    state.phase = {
      kind: 'movementOrder',
      playerId: 'p1',
      movementRound: 3,
      dice: { nutmeg: 1, silk: 1, jade: 1, ginseng: 2 },
      remainingBoatIds: ['boat-1', 'boat-2', 'boat-3'],
      movedBoatIds: [],
    }

    state = act(state, { type: 'moveBoat', playerId: 'p1', boatId: 'boat-1' })
    state = act(state, { type: 'moveBoat', playerId: 'p1', boatId: 'boat-2' })
    state = act(state, { type: 'moveBoat', playerId: 'p1', boatId: 'boat-3' })

    expect(state.players.map((player) => player.pesos)).toEqual([18, 12, 26])
    expect(state.market.ginseng).toBe(5)
    expect(state.voyage).toBe(2)
    expect(state.phase.kind).toBe('auction')
  })

  test('scores mortgaged shares and marks every tied leader as a winner', () => {
    const state = fresh()
    state.phase = { kind: 'gameOver' }
    state.market = { nutmeg: 20, silk: 10, jade: 0, ginseng: 0 }
    state.players[0]!.pesos = 10
    state.players[0]!.shares = [
      { id: 'nutmeg-1', commodity: 'nutmeg', mortgaged: false },
      { id: 'silk-1', commodity: 'silk', mortgaged: true },
    ]
    state.players[1]!.pesos = 30
    state.players[1]!.shares = []
    state.players[2]!.pesos = 30
    state.players[2]!.shares = []

    expect(getStandings(state)).toEqual([
      { playerId: 'p2', name: '二号', wealth: 30, winner: true },
      { playerId: 'p3', name: '三号', wealth: 30, winner: true },
      { playerId: 'p1', name: '一号', wealth: 25, winner: false },
    ])
  })
})

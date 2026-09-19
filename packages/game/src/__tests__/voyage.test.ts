import { describe, expect, test } from 'vitest'
import {
  createGame,
  getDecision,
  getStandings,
  transition,
  validateState,
  type GameAction,
  type GameState,
  type SettlementIncome,
  type SettlementPayment,
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

function reachSmallPilot(
  seed: number,
  startPositions: readonly [number, number, number],
  variant: 'standard' | 'strengthened' = 'standard',
): GameState {
  let state = fresh(variant)
  const created = createGame({ players, startingPlayerId: 'p1', seed, pirateVariant: variant })
  if (!created.ok) throw new Error(created.error.message)
  state = created.value
  state = act(state, { type: 'bid', playerId: 'p1', amount: 1, mortgageShareIds: [] })
  state = act(state, { type: 'passAuction', playerId: 'p2' })
  state = act(state, { type: 'passAuction', playerId: 'p3' })
  state = act(state, { type: 'buyShare', playerId: 'p1', shareId: null, mortgageShareIds: [] })
  state = act(state, { type: 'selectCargo', playerId: 'p1', commodities: ['nutmeg', 'silk', 'jade'] })
  state = act(state, {
    type: 'launchBoats',
    playerId: 'p1',
    assignments: [
      { boatId: 'boat-1', commodity: 'nutmeg', lane: 0, startPosition: startPositions[0] },
      { boatId: 'boat-2', commodity: 'silk', lane: 1, startPosition: startPositions[1] },
      { boatId: 'boat-3', commodity: 'jade', lane: 2, startPosition: startPositions[2] },
    ],
  })
  state = act(state, { type: 'placeAccomplice', playerId: 'p1', location: { area: 'smallPilot' }, mortgageShareIds: [] })
  state = act(state, { type: 'passPlacement', playerId: 'p2' })
  state = act(state, { type: 'passPlacement', playerId: 'p3' })
  state = act(state, { type: 'passPlacement', playerId: 'p1' })

  while (state.phase.kind === 'movementOrder') {
    const boatId = state.phase.remainingBoatIds[0]
    if (!boatId) throw new Error('movement order unexpectedly has no boat')
    state = act(state, { type: 'moveBoat', playerId: 'p1', boatId })
  }
  while (state.phase.kind === 'placement') {
    state = act(state, { type: 'passPlacement', playerId: state.phase.playerId })
  }
  while (state.phase.kind === 'movementOrder') {
    const boatId = state.phase.remainingBoatIds[0]
    if (!boatId) throw new Error('movement order unexpectedly has no boat')
    state = act(state, { type: 'moveBoat', playerId: 'p1', boatId })
  }
  while (state.phase.kind === 'placement') {
    state = act(state, { type: 'passPlacement', playerId: state.phase.playerId })
  }
  return state
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

  test.each(['standard', 'strengthened'] as const)('settles without a third-round roll when the small pilot sends the last boat to port (%s pirates)', (variant) => {
    let state = reachSmallPilot(347, [1, 3, 5], variant)
    expect(state.phase).toMatchObject({ kind: 'smallPilot', playerId: 'p1' })
    expect(state.boats.map((boat) => [boat.id, boat.status, boat.position])).toEqual([
      ['boat-1', 'sailing', 13],
      ['boat-2', 'port', null],
      ['boat-3', 'port', null],
    ])
    const rngBeforePilot = state.rng.value

    state = act(state, { type: 'pilotMove', playerId: 'p1', moves: [{ boatId: 'boat-1', delta: 1 }] })

    expect(state.rng.value).toBe(rngBeforePilot)
    expect(state.voyage).toBe(2)
    expect(state.phase).toMatchObject({ kind: 'auction', currentPlayerId: 'p1' })
    expect(state.boats.every((boat) => boat.status === 'unlaunched')).toBe(true)
    expect(validateState(state)).toEqual([])
  })

  test('keeps the final pilot opportunity after every boat reaches port in round two', () => {
    let state = reachSmallPilot(1413, [3, 3, 3])
    expect(state.boats.every((boat) => boat.status === 'port')).toBe(true)
    expect(state.phase).toMatchObject({ kind: 'smallPilot', playerId: 'p1' })

    state = act(state, { type: 'pilotMove', playerId: 'p1', moves: [] })

    expect(state.phase).toMatchObject({ kind: 'auction', currentPlayerId: 'p1' })
    expect(state.voyage).toBe(2)
    expect(validateState(state)).toEqual([])
  })

  test('reaches game over when the final pilot move sends a terminal-market cargo to port', () => {
    let state = reachSmallPilot(347, [1, 3, 5])
    state.market.nutmeg = 20
    const rngBeforePilot = state.rng.value

    state = act(state, { type: 'pilotMove', playerId: 'p1', moves: [{ boatId: 'boat-1', delta: 1 }] })

    expect(state.phase).toEqual({ kind: 'gameOver' })
    expect(state.market.nutmeg).toBe(30)
    expect(state.rng.value).toBe(rngBeforePilot)
    expect(validateState(state)).toEqual([])
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

  test('records itemized settlement income and insurance payments', () => {
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
    const settled = transition(state, { type: 'moveBoat', playerId: 'p1', boatId: 'boat-3' })
    expect(settled.ok).toBe(true)
    if (!settled.ok) return

    const event = settled.value.events.find((candidate) => candidate.type === 'voyageSettled')
    expect(event).toBeTruthy()
    const incomes = event!.incomes as SettlementIncome[]
    const payments = event!.payments as SettlementPayment[]
    const deltas = event!.playerDeltas as Array<{ playerId: string; pesosDelta: number }>

    expect(incomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: 'p1', category: 'cargo', amount: 18, boatId: 'boat-1', commodity: 'ginseng' }),
      expect.objectContaining({ playerId: 'p2', category: 'portBerth', amount: 6, berth: 'A' }),
      expect.objectContaining({ playerId: 'p2', category: 'shipyardBerth', amount: 6, berth: 'A', paidBy: 'insurance' }),
    ]))
    expect(payments).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: 'p3', category: 'insurance', amount: 6, berth: 'A', receiverId: 'p2', coveredByTreasury: 0 }),
      expect.objectContaining({ playerId: 'p3', category: 'insurance', amount: 8, berth: 'B', receiverId: null, coveredByTreasury: 0 }),
    ]))
    expect(incomes).toHaveLength(3)
    expect(payments).toHaveLength(2)

    for (const delta of deltas) {
      const income = incomes.filter((entry) => entry.playerId === delta.playerId).reduce((sum, entry) => sum + entry.amount, 0)
      const paid = payments.filter((entry) => entry.playerId === delta.playerId).reduce((sum, entry) => sum + entry.amount, 0)
      expect(income - paid).toBeCloseTo(delta.pesosDelta)
    }
  })

  test('records forced mortgage financing separately from voyage income and treasury coverage', () => {
    let state = fresh()
    state.players[0]!.pesos = 0
    state.players[1]!.pesos = 0
    state.players[2]!.pesos = 0
    state.players[2]!.shares = [{ id: 'forced-nutmeg', commodity: 'nutmeg', mortgaged: false }]
    state.boats[0]!.position = 0
    state.boats[1]!.position = 0
    state.boats[2]!.position = 0
    state.accomplices[4]!.location = { area: 'shipyard', berth: 'A' }
    state.accomplices[8]!.location = { area: 'insurance' }
    state.phase = {
      kind: 'movementOrder',
      playerId: 'p1',
      movementRound: 3,
      dice: { nutmeg: 1, silk: 1, jade: 1, ginseng: 1 },
      remainingBoatIds: ['boat-1', 'boat-2', 'boat-3'],
      movedBoatIds: [],
    }

    state = act(state, { type: 'moveBoat', playerId: 'p1', boatId: 'boat-1' })
    state = act(state, { type: 'moveBoat', playerId: 'p1', boatId: 'boat-2' })
    const settled = transition(state, { type: 'moveBoat', playerId: 'p1', boatId: 'boat-3' })
    expect(settled.ok).toBe(true)
    if (!settled.ok) return

    const event = settled.value.events.find((candidate) => candidate.type === 'voyageSettled')
    const incomes = event!.incomes as SettlementIncome[]
    const payments = event!.payments as SettlementPayment[]
    expect(incomes).toContainEqual({ playerId: 'p3', category: 'forcedMortgage', amount: 12 })
    expect(incomes).toContainEqual({ playerId: 'p2', category: 'shipyardBerth', amount: 6, berth: 'A', paidBy: 'insurance' })
    expect(payments).toEqual([
      { playerId: 'p3', category: 'insurance', amount: 6, berth: 'A', receiverId: 'p2', coveredByTreasury: 0 },
      { playerId: 'p3', category: 'insurance', amount: 6, berth: 'B', receiverId: null, coveredByTreasury: 2 },
      { playerId: 'p3', category: 'insurance', amount: 0, berth: 'C', receiverId: null, coveredByTreasury: 15 },
    ])
    expect(payments.reduce((sum, payment) => sum + payment.coveredByTreasury, 0)).toBe(17)
    expect(settled.value.state.players[2]!.shares[0]!.mortgaged).toBe(true)
    expect(settled.value.state.players[2]!.pesos).toBe(0)
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

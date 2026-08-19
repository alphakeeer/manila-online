import { describe, expect, test } from 'vitest'
import {
  createGame,
  getDecision,
  transition,
  type GameAction,
  type GameState,
} from '../index'

const players = [
  { id: 'p1', name: '一号' },
  { id: 'p2', name: '二号' },
  { id: 'p3', name: '三号' },
]

function fresh(seed = 7): GameState {
  const result = createGame({ players, startingPlayerId: 'p1', seed, pirateVariant: 'standard' })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function act(state: GameState, action: GameAction): GameState {
  const result = transition(state, action)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value.state
}

function reachLaunch(): GameState {
  let state = fresh()
  state = act(state, { type: 'bid', playerId: 'p1', amount: 1, mortgageShareIds: [] })
  state = act(state, { type: 'passAuction', playerId: 'p2' })
  state = act(state, { type: 'passAuction', playerId: 'p3' })
  state = act(state, { type: 'buyShare', playerId: 'p1', shareId: null, mortgageShareIds: [] })
  state = act(state, { type: 'selectCargo', playerId: 'p1', commodities: ['nutmeg', 'silk', 'jade'] })
  return state
}

function reachPlacement(): GameState {
  return act(reachLaunch(), {
    type: 'launchBoats',
    playerId: 'p1',
    assignments: [
      { boatId: 'boat-1', commodity: 'nutmeg', lane: 0, startPosition: 4 },
      { boatId: 'boat-2', commodity: 'silk', lane: 1, startPosition: 3 },
      { boatId: 'boat-3', commodity: 'jade', lane: 2, startPosition: 2 },
    ],
  })
}

describe('auction and harbor master duties', () => {
  test('rejects an out-of-turn auction action without changing the original state', () => {
    const state = fresh()
    const before = structuredClone(state)
    const result = transition(state, { type: 'passAuction', playerId: 'p2' })

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } })
    expect(state).toEqual(before)
  })

  test('selects a seeded random harbor master when every player passes the first auction', () => {
    let state = fresh(11)
    state = act(state, { type: 'passAuction', playerId: 'p1' })
    state = act(state, { type: 'passAuction', playerId: 'p2' })
    state = act(state, { type: 'passAuction', playerId: 'p3' })

    expect(players.map((player) => player.id)).toContain(state.harborMasterId)
    expect(state.phase.kind).toBe('sharePurchase')
    expect(fresh(11).rng.value).not.toBe(state.rng.value)
  })

  test('charges the winning bid and mortgages only the declared collateral', () => {
    let state = fresh()
    const collateral = state.players[0]?.shares[0]?.id
    if (!collateral) throw new Error('fixture requires a share')

    state = act(state, { type: 'bid', playerId: 'p1', amount: 40, mortgageShareIds: [collateral] })
    state = act(state, { type: 'passAuction', playerId: 'p2' })
    state = act(state, { type: 'passAuction', playerId: 'p3' })

    const winner = state.players.find((player) => player.id === 'p1')
    expect(winner?.pesos).toBe(2)
    expect(winner?.shares.find((share) => share.id === collateral)?.mortgaged).toBe(true)
    expect(state.harborMasterId).toBe('p1')
  })

  test('allows the harbor master to skip buying, choose three cargoes, and launch at a total of nine', () => {
    const launch = reachLaunch()
    expect(getDecision(launch)).toMatchObject({ kind: 'launch', playerId: 'p1' })

    const invalid = transition(launch, {
      type: 'launchBoats',
      playerId: 'p1',
      assignments: [
        { boatId: 'boat-1', commodity: 'nutmeg', lane: 0, startPosition: 5 },
        { boatId: 'boat-2', commodity: 'silk', lane: 1, startPosition: 5 },
        { boatId: 'boat-3', commodity: 'jade', lane: 2, startPosition: 0 },
      ],
    })
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_START_SUM' } })

    const placed = reachPlacement()
    expect(placed.boats.map((boat) => boat.startPosition)).toEqual([4, 3, 2])
    expect(placed.phase).toMatchObject({ kind: 'placement', playerId: 'p1', placementRound: 1 })
  })
})

describe('finance and placement', () => {
  test('mortgages and redeems a share without advancing the active decision', () => {
    let state = fresh()
    const shareId = state.players[1]?.shares[0]?.id
    if (!shareId) throw new Error('fixture requires a share')

    state = act(state, { type: 'mortgageShare', playerId: 'p2', shareId })
    expect(state.players[1]?.pesos).toBe(42)
    expect(state.phase).toMatchObject({ kind: 'auction', currentPlayerId: 'p1' })

    state = act(state, { type: 'redeemShare', playerId: 'p2', shareId })
    expect(state.players[1]?.pesos).toBe(27)
    expect(state.players[1]?.shares.find((share) => share.id === shareId)?.mortgaged).toBe(false)
  })

  test('lists only the cheapest empty cargo slot and pays insurance income immediately', () => {
    let state = reachPlacement()
    const decision = getDecision(state)
    expect(decision).toMatchObject({ kind: 'placement', playerId: 'p1' })
    if (decision?.kind !== 'placement') return

    expect(decision.options).toContainEqual({
      location: { area: 'cargo', boatId: 'boat-1', slot: 0 },
      cost: 2,
    })
    expect(decision.options).not.toContainEqual({
      location: { area: 'cargo', boatId: 'boat-1', slot: 1 },
      cost: 3,
    })

    state = act(state, {
      type: 'placeAccomplice',
      playerId: 'p1',
      location: { area: 'insurance' },
      mortgageShareIds: [],
    })
    expect(state.players[0]?.pesos).toBe(39)
    expect(state.phase).toMatchObject({ kind: 'placement', playerId: 'p2' })
  })

  test('offers the pirate captain before the pirate crew position', () => {
    let state = reachPlacement()
    const first = getDecision(state)
    if (first?.kind !== 'placement') throw new Error('expected placement')
    expect(first.options.some((option) => option.location.area === 'pirateCaptain')).toBe(true)
    expect(first.options.some((option) => option.location.area === 'pirateCrew')).toBe(false)

    state = act(state, {
      type: 'placeAccomplice',
      playerId: 'p1',
      location: { area: 'pirateCaptain' },
      mortgageShareIds: [],
    })
    const second = getDecision(state)
    if (second?.kind !== 'placement') throw new Error('expected placement')
    expect(second.options.some((option) => option.location.area === 'pirateCrew')).toBe(true)
  })

  test('runs two placement rounds before the first movement in a three-player game', () => {
    let state = reachPlacement()
    state = act(state, { type: 'placeAccomplice', playerId: 'p1', location: { area: 'insurance' }, mortgageShareIds: [] })
    state = act(state, { type: 'placeAccomplice', playerId: 'p2', location: { area: 'port', berth: 'A' }, mortgageShareIds: [] })
    state = act(state, { type: 'placeAccomplice', playerId: 'p3', location: { area: 'port', berth: 'B' }, mortgageShareIds: [] })

    expect(state.phase).toMatchObject({ kind: 'placement', placementRound: 2, movementRound: 0, playerId: 'p1' })
  })

  test('allows a destitute player with no available credit to use a stowaway', () => {
    let state = reachPlacement()
    const player = state.players[0]!
    player.pesos = 0
    player.shares.forEach((share) => { share.mortgaged = true })
    const decision = getDecision(state)
    expect(decision).toMatchObject({ kind: 'placement', playerId: 'p1', canStowaway: true })

    state = act(state, {
      type: 'placeAccomplice',
      playerId: 'p1',
      location: { area: 'cargo', boatId: 'boat-1', slot: 0 },
      mortgageShareIds: [],
      stowaway: true,
    })
    expect(state.players[0]?.pesos).toBe(0)
  })

  test('rolls only the three loaded cargo dice', () => {
    let state = reachPlacement()
    state = act(state, { type: 'passPlacement', playerId: 'p1' })
    state = act(state, { type: 'passPlacement', playerId: 'p2' })
    state = act(state, { type: 'passPlacement', playerId: 'p3' })

    const decision = getDecision(state)
    expect(decision).toMatchObject({ kind: 'movementOrder', movementRound: 1 })
    if (decision?.kind !== 'movementOrder') return
    expect(decision.dice.ginseng).toBe(0)
    expect([decision.dice.nutmeg, decision.dice.silk, decision.dice.jade].every((roll) => roll >= 1 && roll <= 6)).toBe(true)
  })
})

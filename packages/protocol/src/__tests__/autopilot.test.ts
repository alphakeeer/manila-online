import { GameActionSchema, type GameRoomSnapshot } from '../index.js'
import { describe, expect, test } from 'vitest'
import { chooseAction } from '../autopilot.js'

type Decision = NonNullable<GameRoomSnapshot['decision']>

function snapshotWith(decision: Decision, pesos = 20): GameRoomSnapshot {
  return {
    room: { code: 'CODE2345', revision: 3, pirateVariant: 'standard', status: 'playing', readOnly: false },
    public: {
      voyage: 1, phase: { kind: decision.kind, currentSeat: 1, dice: null }, harborMasterSeat: 1, highestBid: null,
      market: { nutmeg: 0, silk: 0, jade: 0, ginseng: 0 },
      boats: [{ id: 'boat-1', commodity: 'silk', lane: 0, position: 13, status: 'sailing', berth: null, plundered: false }],
      accomplices: [], players: [{ seat: 1, nickname: 'P1', autopilot: null }], shareSupply: { nutmeg: 5, silk: 5, jade: 5, ginseng: 5 }, standings: null,
    },
    self: { seat: 1, pesos, shares: [{ id: 'share-1', commodity: 'jade', mortgaged: false }, { id: 'share-2', commodity: 'silk', mortgaged: false }] },
    decision,
  }
}

/** Deterministic sequence so every branch is reachable across seeds. */
function seeded(seed: number) {
  let state = seed
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
}

const decisions: Decision[] = [
  { kind: 'auction', minimumBid: 18, maximumBid: 44, availableCollateralShareIds: ['share-1', 'share-2'] },
  { kind: 'sharePurchase', available: [{ commodity: 'silk', price: 5 }, { commodity: 'jade', price: 30 }], availableCollateralShareIds: ['share-1'] },
  { kind: 'cargoSelection', commodities: ['nutmeg', 'silk', 'jade', 'ginseng'] },
  { kind: 'launch', boatIds: ['b1', 'b2', 'b3'], commodities: ['silk', 'jade', 'ginseng'], lanes: [0, 1, 2], startPositionTriples: [[3, 3, 3], [5, 4, 0], [0, 4, 5]] },
  { kind: 'placement', placementRound: 1, options: [{ location: { area: 'cargo', boatId: 'boat-1', slot: 0 }, cost: 3 }, { location: { area: 'port', berth: 'A' }, cost: 40 }, { location: { area: 'insurance' }, cost: 0 }], canStowaway: false, canPass: true, availableCollateralShareIds: [] },
  { kind: 'movementOrder', movementRound: 1, dice: { nutmeg: 0, silk: 3, jade: 2, ginseng: 1 }, remainingBoatIds: ['b1', 'b2'] },
  { kind: 'largePilot', movableBoatIds: ['b1'], legalMoves: [[], [{ boatId: 'b1', delta: 2 }], [{ boatId: 'b1', delta: -1 }, { boatId: 'b2', delta: 1 }]] },
  { kind: 'pirateBoarding', accompliceId: 'a-9', eligibleBoatIds: ['boat-1'], displaceableByBoat: { 'boat-1': ['a-2'] }, canStay: true },
  { kind: 'plunderDestination', boatId: 'boat-1', destinations: ['port', 'shipyard'] },
]

describe('random autopilot', () => {
  test.each(decisions.map((decision) => [decision.kind, decision] as const))('only emits schema-valid choices offered by %s', (_, decision) => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const snapshot = snapshotWith(decision)
      const action = chooseAction(snapshot, seeded(seed))
      expect(action).not.toBeNull()
      expect(GameActionSchema.safeParse(action).success).toBe(true)
      if (action?.type === 'bid' && decision.kind === 'auction') {
        expect(action.amount).toBeGreaterThanOrEqual(decision.minimumBid)
        expect(action.amount).toBeLessThanOrEqual(decision.maximumBid)
        expect(snapshot.self.pesos + action.mortgageShareIds.length * 12).toBeGreaterThanOrEqual(action.amount)
      }
      if (action?.type === 'buyShare' && action.commodity) expect(action.commodity).toBe('silk')
      if (action?.type === 'selectCargo') expect(new Set(action.commodities).size).toBe(3)
      if (action?.type === 'launchBoats' && decision.kind === 'launch') {
        expect(decision.startPositionTriples).toContainEqual(action.assignments.map((row) => row.startPosition))
        expect(new Set(action.assignments.map((row) => row.commodity)).size).toBe(3)
      }
      if (action?.type === 'placeAccomplice') expect(action.location.area).not.toBe('port')
      if (action?.type === 'moveBoat' && decision.kind === 'movementOrder') expect(decision.remainingBoatIds).toContain(action.boatId)
      if (action?.type === 'pilotMove' && decision.kind === 'largePilot') expect(decision.legalMoves).toContainEqual(action.moves)
    }
  })

  test('falls back to the safest option after a rejection', () => {
    expect(chooseAction(snapshotWith(decisions[0]!), seeded(3), true)).toEqual({ type: 'passAuction' })
    expect(chooseAction(snapshotWith(decisions[4]!), seeded(3), true)).toEqual({ type: 'passPlacement' })
    expect(chooseAction(snapshotWith(decisions[6]!), seeded(3), true)).toEqual({ type: 'pilotMove', moves: [] })
    expect(chooseAction(snapshotWith(decisions[7]!), seeded(3), true)).toEqual({ type: 'boardPirate', accompliceId: 'a-9', boatId: null })
  })

  test('steady style protects an absent player\'s purse', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(chooseAction(snapshotWith(decisions[0]!), seeded(seed), false, 'steady')).toEqual({ type: 'passAuction' })
      expect(chooseAction(snapshotWith(decisions[1]!), seeded(seed), false, 'steady')).toEqual({ type: 'buyShare', commodity: null, mortgageShareIds: [] })
      const placement = chooseAction(snapshotWith(decisions[4]!), seeded(seed), false, 'steady')
      if (placement?.type === 'placeAccomplice') {
        expect(placement.location.area).toBe('cargo')
        expect(placement.stowaway).toBe(false)
      } else expect(placement).toEqual({ type: 'passPlacement' })
    }
  })

  test('does nothing without a decision', () => {
    expect(chooseAction({ ...snapshotWith(decisions[0]!), decision: null })).toBeNull()
  })
})

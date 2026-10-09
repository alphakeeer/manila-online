import type { GameRoomSnapshot } from '@manila/protocol'
import { describe, expect, test } from 'vitest'
import { deriveEvents, rolledDice } from '../gameEvents'

function base(): GameRoomSnapshot {
  return {
    room: { code: 'CODE2345', revision: 1, pirateVariant: 'standard', status: 'playing', readOnly: false },
    public: {
      voyage: 1,
      phase: { kind: 'auction', currentSeat: 1, dice: null },
      harborMasterSeat: null,
      highestBid: null,
      market: { nutmeg: 0, silk: 0, jade: 0, ginseng: 0 },
      boats: [
        { id: 'boat-1', commodity: 'silk', lane: 0, position: 4, status: 'sailing', berth: null, plundered: false },
      ],
      accomplices: [{ id: 'a-1', seat: 2, location: null }],
      players: [{ seat: 1, nickname: '阿青' }, { seat: 2, nickname: 'Bo' }, { seat: 3, nickname: 'Cy' }],
      shareSupply: { nutmeg: 5, silk: 5, jade: 5, ginseng: 5 },
      standings: null,
    },
    self: { seat: 1, pesos: 30, shares: [] },
    decision: null,
  }
}

function next(change: (snapshot: GameRoomSnapshot) => void): GameRoomSnapshot {
  const snapshot = structuredClone(base())
  snapshot.room.revision = 2
  change(snapshot)
  return snapshot
}

const texts = (previous: GameRoomSnapshot, current: GameRoomSnapshot) => deriveEvents(previous, current).map((event) => event.text)

describe('deriveEvents', () => {
  test('names the bidder when the high bid rises', () => {
    expect(texts(base(), next((s) => { s.public.highestBid = { amount: 7, bidderSeat: 1 }; s.public.phase.currentSeat = 2 }))).toContain('阿青 出价 7 比索')
  })

  test('reads a turn change without a raise as a pass', () => {
    const before = next((s) => { s.room.revision = 1; s.public.highestBid = { amount: 7, bidderSeat: 1 }; s.public.phase.currentSeat = 2 })
    const after = next((s) => { s.room.revision = 2; s.public.highestBid = { amount: 7, bidderSeat: 1 }; s.public.phase.currentSeat = 3 })
    expect(texts(before, after)).toEqual(['Bo 放弃竞拍'])
  })

  test('reports placement, boat movement, docking and market changes in plain words', () => {
    const after = next((s) => {
      s.public.phase.kind = 'movementOrder'
      s.public.accomplices[0]!.location = { area: 'cargo', boatId: 'boat-1', slot: 1 }
      s.public.boats[0]!.position = 9
      s.public.market.silk = 10
    })
    const before = next((s) => { s.room.revision = 1; s.public.phase.kind = 'movementOrder' })
    expect(texts(before, after)).toEqual(['Bo 派同伙到 丝绸舢板 · 第 2 位', '丝绸舢板前进 5 格 → 9', '丝绸 行情 0 → 10'])
    const docked = next((s) => { s.room.revision = 3; s.public.phase.kind = 'movementOrder'; s.public.boats[0] = { ...s.public.boats[0]!, status: 'port', berth: 'A', lane: null, position: null } })
    expect(texts(before, docked)).toContain('丝绸舢板抵达马尼拉港口 A')
  })

  test('ignores stale or repeated revisions and only flags fresh dice', () => {
    const rolled = next((s) => { s.public.phase.dice = { nutmeg: 1, silk: 4, jade: 2, ginseng: 6 } })
    expect(deriveEvents(rolled, rolled)).toEqual([])
    expect(deriveEvents(null, rolled)).toEqual([])
    expect(rolledDice(base(), rolled)).toBe(true)
    expect(rolledDice(rolled, { ...rolled, room: { ...rolled.room, revision: 3 } })).toBe(false)
  })
})

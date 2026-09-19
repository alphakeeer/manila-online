// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameRoomSnapshot } from '@manila/protocol'
import { GameBoard } from '../GameBoard'

afterEach(cleanup)

function snapshotWithPlacement(): GameRoomSnapshot {
  return {
    room: { code: 'CODE2345', revision: 1, pirateVariant: 'standard', status: 'playing', readOnly: false },
    public: {
      voyage: 1,
      phase: { kind: 'placement', currentSeat: 1, dice: null },
      harborMasterSeat: 1,
      highestBid: null,
      market: { nutmeg: 0, silk: 0, jade: 0, ginseng: 0 },
      boats: [{ id: 'boat-1', commodity: 'nutmeg', lane: 0, position: 4, status: 'sailing', berth: null, plundered: false }],
      accomplices: [{ id: 'accomplice-1', seat: 1, location: { area: 'smallPilot' } }],
      players: [{ seat: 1, nickname: 'P1' }],
      shareSupply: { nutmeg: 5, silk: 5, jade: 5, ginseng: 5 },
      standings: null,
    },
    self: { seat: 1, pesos: 30, shares: [] },
    decision: {
      kind: 'placement',
      placementRound: 1,
      options: [
        { location: { area: 'port', berth: 'A' }, cost: 4 },
        { location: { area: 'cargo', boatId: 'boat-1', slot: 0 }, cost: 2 },
      ],
      canStowaway: false,
      canPass: true,
      availableCollateralShareIds: [],
    },
  }
}

describe('GameBoard placement hotspots', () => {
  it('selects the same placement location from board hotspots', () => {
    const onSelect = vi.fn()
    render(<GameBoard snapshot={snapshotWithPlacement()} placementChoice={null} onSelectPlacement={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: '放置同伙：port，费用 4' }))
    expect(onSelect).toHaveBeenCalledWith({ area: 'port', berth: 'A' })

    fireEvent.click(screen.getByRole('button', { name: '货物位 1，费用 2' }))
    expect(onSelect).toHaveBeenCalledWith({ area: 'cargo', boatId: 'boat-1', slot: 0 })

    expect(screen.getByLabelText('1 号位同伙：smallPilot')).toBeTruthy()
  })
})

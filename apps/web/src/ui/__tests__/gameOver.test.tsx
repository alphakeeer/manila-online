// @vitest-environment jsdom
import type { GameRoomSnapshot, SettlementHistory } from '@manila/protocol'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GameOverScreen } from '../GameOver'

afterEach(cleanup)

const snapshot: GameRoomSnapshot = {
  room: { code: 'CODE2345', revision: 90, pirateVariant: 'standard', status: 'finished', readOnly: true },
  public: {
    voyage: 2, phase: { kind: 'gameOver', currentSeat: null, dice: null }, harborMasterSeat: null, highestBid: null,
    market: { nutmeg: 30, silk: 10, jade: 5, ginseng: 0 }, boats: [], accomplices: [],
    players: [{ seat: 1, nickname: '阿青', autopilot: null }, { seat: 2, nickname: 'Bo', autopilot: null }, { seat: 3, nickname: '小满', autopilot: null }, { seat: 4, nickname: 'Dee', autopilot: null }],
    shareSupply: { nutmeg: 1, silk: 2, jade: 3, ginseng: 4 },
    standings: [{ seat: 2, nickname: 'Bo', wealth: 120, winner: true }, { seat: 1, nickname: '阿青', wealth: 90, winner: false }, { seat: 3, nickname: '小满', wealth: 60, winner: false }, { seat: 4, nickname: 'Dee', wealth: 12, winner: false }],
  },
  self: { seat: 1, pesos: 40, shares: [] },
  decision: null,
}

const history: SettlementHistory = {
  settlements: [
    { voyage: 1, public: { voyage: 1, boats: [{ id: 'b1', commodity: 'nutmeg', status: 'port', berth: 'A', plundered: false }, { id: 'b2', commodity: 'silk', status: 'shipyard', berth: 'A', plundered: true }], market: [{ commodity: 'nutmeg', from: 0, to: 20 }, { commodity: 'silk', from: 0, to: 5 }] },
      self: { incomes: [{ category: 'cargo', amount: 24 }, { category: 'portBerth', amount: 6, berth: 'A' }], payments: [], pesosDelta: 30 } },
    { voyage: 2, public: { voyage: 2, boats: [{ id: 'b3', commodity: 'nutmeg', status: 'port', berth: 'A', plundered: false }], market: [{ commodity: 'nutmeg', from: 20, to: 30 }, { commodity: 'silk', from: 5, to: 10 }] },
      self: { incomes: [], payments: [{ category: 'insurance', amount: 8, berth: 'A', receiverId: null, coveredByTreasury: 0 }], pesosDelta: -8 } },
  ],
}

describe('GameOverScreen', () => {
  it('celebrates the winner, ranks every seat and summarises the voyages', () => {
    const { container } = render(<GameOverScreen snapshot={snapshot} history={history} />)
    expect(screen.getAllByText('最终排名')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Bo')
    expect(screen.getByText(/肉豆蔻行情冲上 30/)).toBeTruthy()
    const spots = [...container.querySelectorAll('.podium-stage__spot')].map((spot) => spot.querySelector('.podium-stage__name')?.textContent)
    expect(spots).toEqual(['阿青（你）', 'Bo', '小满'])
    expect(container.querySelector('.podium-rest')?.textContent).toContain('Dee')
    expect(screen.getByText('2 / 4')).toBeTruthy()
    expect(container.querySelector('.go-tiles')?.textContent).toContain('+30第 1 航程')
    expect(container.querySelector('.go-tiles__boats')?.textContent).toBe('⚓2🛠1☠1')
    expect(screen.getByLabelText('货物利润 24，港口泊位 6')).toBeTruthy()
  })

  it('collapses to a compact standings bar so the board stays visible', () => {
    const { container } = render(<GameOverScreen snapshot={snapshot} history={history} />)
    fireEvent.click(screen.getByRole('button', { name: '查看棋盘' }))
    expect(container.querySelector('.gameover')).toBeNull()
    expect(container.querySelector('.standings')?.textContent).toContain('Bo · 120 比索 · 你第 2 名')
    fireEvent.click(screen.getByRole('button', { name: '展开结算' }))
    expect(container.querySelector('.gameover')).not.toBeNull()
  })
})

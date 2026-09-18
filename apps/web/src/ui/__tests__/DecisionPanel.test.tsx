// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { createGame, type Decision } from '@manila/game'
import { DecisionPanel } from '../DecisionPanel'

afterEach(cleanup)

test('renders each cargo choice with its semantic commodity colour class', () => {
  const created = createGame({ players: [{ id: 'p1', name: '阿兰' }, { id: 'p2', name: '阿明' }, { id: 'p3', name: '阿青' }], startingPlayerId: 'p1', seed: 7 })
  if (!created.ok) throw new Error(created.error.message)
  const decision: Decision = { kind: 'cargoSelection', playerId: 'p1', commodities: ['nutmeg', 'silk', 'jade', 'ginseng'] }

  render(<DecisionPanel state={created.value} decision={decision} error={null} onAction={() => undefined} />)

  expect(screen.getByText('丝绸')).toHaveClass('commodity--silk')
  expect(screen.getByText('肉豆蔻')).toHaveClass('commodity--nutmeg')
})

test('groups placement options with localized labels and coloured cargo names', () => {
  const created = createGame({ players: [{ id: 'p1', name: '阿兰' }, { id: 'p2', name: '阿明' }, { id: 'p3', name: '阿青' }], startingPlayerId: 'p1', seed: 7 })
  if (!created.ok) throw new Error(created.error.message)
  const decision: Decision = {
    kind: 'placement',
    playerId: 'p1',
    placementRound: 1,
    pesos: 25,
    availableCollateralShareIds: [],
    canStowaway: false,
    canPass: true,
    options: [
      { location: { area: 'cargo', boatId: 'boat-1', slot: 0 }, cost: 2 },
      { location: { area: 'port', berth: 'A' }, cost: 4 },
      { location: { area: 'shipyard', berth: 'A' }, cost: 4 },
      { location: { area: 'smallPilot' }, cost: 2 },
      { location: { area: 'pirateCaptain' }, cost: 5 },
      { location: { area: 'insurance' }, cost: 0 },
    ],
  }
  created.value.boats[0]!.commodity = 'silk'

  render(<DecisionPanel state={created.value} decision={decision} error={null} onAction={() => undefined} />)

  expect(screen.getByRole('heading', { name: '货物位' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '港口与修船厂' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '领航员与海盗' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '其他岗位' })).toBeInTheDocument()
  expect(screen.getByText('丝绸')).toHaveClass('commodity--silk')
  expect(screen.getByRole('button', { name: /海盗船长/ })).toBeInTheDocument()
})

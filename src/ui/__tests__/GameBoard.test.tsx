// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { createGame, transition, type Decision } from '../../game'
import { GameBoard } from '../GameBoard'

afterEach(cleanup)

test('renders a cargo accomplice as a player image on its boat share', () => {
  const created = createGame({ players: [{ id: 'p1', name: '阿青' }, { id: 'p2', name: '阿明' }, { id: 'p3', name: '阿兰' }], startingPlayerId: 'p1', seed: 7 })
  if (!created.ok) throw new Error(created.error.message)
  const state = created.value
  state.selectedCommodities = ['nutmeg', 'silk', 'jade']
  state.boats.forEach((boat, index) => { boat.commodity = state.selectedCommodities[index]!; boat.lane = index as 0 | 1 | 2; boat.position = [4, 3, 2][index]!; boat.status = 'sailing' })
  state.phase = { kind: 'placement', playerId: 'p1', placementRound: 1, movementRound: 0, actedPlayerIds: [] }
  const placed = transition(state, { type: 'placeAccomplice', playerId: 'p1', location: { area: 'cargo', boatId: 'boat-1', slot: 0 }, mortgageShareIds: [] })
  if (!placed.ok) throw new Error(placed.error.message)

  render(<GameBoard state={placed.value.state} decision={null} showPlayers onAction={() => undefined} />)
  expect(screen.getByRole('img', { name: '阿青的同伙' })).toHaveClass('share-player')
})

test('hides player sprites when the presentation toggle is off', () => {
  const created = createGame({ players: [{ id: 'p1', name: '阿青' }, { id: 'p2', name: '阿明' }, { id: 'p3', name: '阿兰' }], startingPlayerId: 'p1', seed: 7 })
  if (!created.ok) throw new Error(created.error.message)
  const state = created.value
  state.selectedCommodities = ['nutmeg', 'silk', 'jade']
  state.boats.forEach((boat, index) => { boat.commodity = state.selectedCommodities[index]!; boat.lane = index as 0 | 1 | 2; boat.position = [4, 3, 2][index]!; boat.status = 'sailing' })
  state.phase = { kind: 'placement', playerId: 'p1', placementRound: 1, movementRound: 0, actedPlayerIds: [] }
  const placed = transition(state, { type: 'placeAccomplice', playerId: 'p1', location: { area: 'cargo', boatId: 'boat-1', slot: 0 }, mortgageShareIds: [] })
  if (!placed.ok) throw new Error(placed.error.message)

  render(<GameBoard state={placed.value.state} decision={null} showPlayers={false} onAction={() => undefined} />)
  expect(screen.queryByRole('img', { name: '阿青的同伙' })).not.toBeInTheDocument()
})

test('previews the three selected cargo boats at route position zero before launch', () => {
  const created = createGame({ players: [{ id: 'p1', name: '阿青' }, { id: 'p2', name: '阿明' }, { id: 'p3', name: '阿兰' }], startingPlayerId: 'p1', seed: 7 })
  if (!created.ok) throw new Error(created.error.message)
  const decision: Decision = {
    kind: 'launch',
    playerId: 'p1',
    boatIds: ['boat-1', 'boat-2', 'boat-3'],
    commodities: ['nutmeg', 'silk', 'jade'],
    lanes: [0, 1, 2],
    startPositionTriples: [[4, 3, 2]],
  }

  render(<GameBoard state={created.value} decision={decision} showPlayers onAction={() => undefined} />)

  expect(screen.getByLabelText('肉豆蔻舢板')).toBeInTheDocument()
  expect(screen.getByLabelText('丝绸舢板')).toBeInTheDocument()
  expect(screen.getByLabelText('玉石舢板')).toBeInTheDocument()
})

test('renders the calibrated 5 by 4 market track and animates a commodity whose price rose', () => {
  const created = createGame({ players: [{ id: 'p1', name: '阿青' }, { id: 'p2', name: '阿明' }, { id: 'p3', name: '阿兰' }], startingPlayerId: 'p1', seed: 7 })
  if (!created.ok) throw new Error(created.error.message)
  created.value.market.nutmeg = 20

  const { container } = render(<GameBoard state={created.value} decision={null} showPlayers onAction={() => undefined} marketChanges={['nutmeg']} />)

  expect(screen.getAllByLabelText(/行情格：/)).toHaveLength(20)
  expect(container.querySelectorAll('.market-cell.highlighted')).toHaveLength(4)
  expect(screen.getByLabelText('行情格：肉豆蔻，20')).toHaveClass('highlighted')
  expect(screen.getByLabelText('行情格：肉豆蔻，30')).not.toHaveClass('highlighted')
  expect(screen.getByLabelText('肉豆蔻行情标记：20')).toHaveClass('market-marker--nutmeg', 'is-moving')
  expect(screen.getByLabelText('人参行情标记：0')).toBeInTheDocument()
})

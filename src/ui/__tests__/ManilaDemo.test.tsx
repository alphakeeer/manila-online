// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { ManilaDemo } from '../ManilaDemo'

afterEach(cleanup)

describe('ManilaDemo', () => {
  test('collects a local hot-seat game configuration', () => {
    render(<ManilaDemo />)
    expect(screen.getByRole('heading', { name: '开始新游戏' })).toBeInTheDocument()
    expect(screen.getByLabelText('玩家人数')).toHaveValue('3')
    expect(screen.getByLabelText('海盗规则')).toHaveValue('standard')
    expect(screen.getByRole('button', { name: '开始航程' })).toBeEnabled()
  })

  test('hides private game data until the active player accepts the handoff', async () => {
    const user = userEvent.setup()
    render(<ManilaDemo />)
    await user.click(screen.getByRole('button', { name: '开始航程' }))
    expect(screen.getByRole('dialog', { name: '玩家交接' })).toBeInTheDocument()
    expect(screen.queryByText('我的股份')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认接手' }))
    expect(screen.getAllByText('第 1 航程')).not.toHaveLength(0)
    expect(screen.getByRole('heading', { name: /竞拍港务长/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放弃竞拍' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '我的股份' })).toBeInTheDocument()
    expect(screen.queryByText(/阿明.*比索/)).not.toBeInTheDocument()
  })

  test('submits an engine action and hands the device to the next player', async () => {
    const user = userEvent.setup()
    render(<ManilaDemo />)
    await user.click(screen.getByRole('button', { name: '开始航程' }))
    await user.click(screen.getByRole('button', { name: '确认接手' }))
    await user.click(screen.getByRole('button', { name: '放弃竞拍' }))
    expect(screen.getByRole('dialog', { name: '玩家交接' })).toBeInTheDocument()
    expect(screen.getByText(/请把设备交给/)).toHaveTextContent('阿明')
  })

  test('closes the rules dialog with Escape and restores its trigger focus', async () => {
    const user = userEvent.setup()
    render(<ManilaDemo />)
    await user.click(screen.getByRole('button', { name: '开始航程' }))
    const rules = screen.getByRole('button', { name: '规则摘要' })
    await user.click(rules)
    expect(screen.getByRole('dialog', { name: '规则摘要' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '规则摘要' })).not.toBeInTheDocument()
    expect(rules).toHaveFocus()
  })
})

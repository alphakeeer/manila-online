// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { ManilaDemo } from '../ManilaDemo'

afterEach(cleanup)

describe('ManilaDemo', () => {
  test('renders the fixed voyage table', () => {
    render(<ManilaDemo />)

    expect(screen.getByText('第 2 航程')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /阿青.*29 比索/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /阿青.*放置同伙/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认放置' })).toBeInTheDocument()
  })

  test('selects a legal accomplice position before confirmation', async () => {
    const user = userEvent.setup()
    render(<ManilaDemo />)

    expect(screen.getAllByRole('listitem', { name: /比索/ })).toHaveLength(3)
    expect(screen.getByRole('img', { name: '马尼拉游戏版图' })).toBeInTheDocument()
    const ginseng = screen.getByRole('button', { name: /人参舢板/ })
    const port = screen.getByRole('button', { name: /港口泊位 B/ })
    const confirm = screen.getByRole('button', { name: '确认放置' })

    expect(ginseng).toHaveAttribute('aria-pressed', 'false')
    expect(port).toHaveAttribute('aria-pressed', 'false')
    expect(confirm).toBeDisabled()

    await user.click(ginseng)

    expect(ginseng).toHaveAttribute('aria-pressed', 'true')
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(screen.getByRole('status')).toHaveTextContent('已选择：人参舢板')
  })
})

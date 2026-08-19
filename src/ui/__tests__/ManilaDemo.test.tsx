// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ManilaDemo } from '../ManilaDemo'

describe('ManilaDemo', () => {
  test('renders the fixed voyage table', () => {
    render(<ManilaDemo />)

    expect(screen.getByText('第 2 航程')).toBeInTheDocument()
    expect(screen.getByText('阿青')).toBeInTheDocument()
    expect(screen.getByText('放置同伙')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认放置' })).toBeInTheDocument()
  })
})

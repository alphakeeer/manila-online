// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarketPriceTrack } from '../MarketPriceTrack'

afterEach(cleanup)

describe('MarketPriceTrack animation timers', () => {
  it('marks changed commodities and clears the timer on unmount', () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    const { container, rerender, unmount } = render(<MarketPriceTrack market={{ nutmeg: 0, silk: 0, jade: 0, ginseng: 0 }} />)

    rerender(<MarketPriceTrack market={{ nutmeg: 5, silk: 0, jade: 0, ginseng: 0 }} />)
    expect(container.querySelector('.market-marker--nutmeg.is-moving')).not.toBeNull()

    unmount()
    expect(clearTimeoutSpy).toHaveBeenCalled()
    vi.useRealTimers()
    clearTimeoutSpy.mockRestore()
  })
})

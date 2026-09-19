// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../Dialog'

afterEach(cleanup)

describe('Dialog focus management', () => {
  it('traps Tab inside the modal and closes on Escape', () => {
    const onClose = vi.fn()
    render(<Dialog title="确认操作" onClose={onClose}>
      <button type="button">确认</button>
      <button type="button">取消</button>
    </Dialog>)

    const confirm = screen.getByRole('button', { name: '确认' })
    const cancel = screen.getByRole('button', { name: '取消' })
    expect(document.activeElement).toBe(confirm)

    cancel.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(confirm)

    confirm.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('restores focus to the opener when unmounted', () => {
    const opener = document.createElement('button')
    opener.textContent = '打开'
    document.body.append(opener)
    opener.focus()

    const { unmount } = render(<Dialog title="确认操作" onClose={() => undefined}><button type="button">确认</button></Dialog>)
    unmount()

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

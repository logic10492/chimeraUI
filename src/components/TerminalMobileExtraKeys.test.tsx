import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileExtraKeys } from './TerminalMobileExtraKeys'

describe('MobileExtraKeys', () => {
  const setup = () => {
    const onSend = vi.fn()
    const onToggleSticky = vi.fn()
    const onFocusTerminal = vi.fn()

    render(
      <MobileExtraKeys
        onSend={onSend}
        onToggleSticky={onToggleSticky}
        onFocusTerminal={onFocusTerminal}
        stickyModifiers={{ ctrl: false, alt: false }}
      />,
    )

    return { onSend, onToggleSticky, onFocusTerminal }
  }

  it('sends the key data and refocuses the terminal when a data key is clicked', () => {
    const { onSend, onToggleSticky, onFocusTerminal } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'ESC' }))

    expect(onSend).toHaveBeenCalledWith('\x1b')
    expect(onFocusTerminal).toHaveBeenCalled()
    expect(onToggleSticky).not.toHaveBeenCalled()
  })

  it('toggles the sticky modifier without sending when a modifier key is clicked', () => {
    const { onSend, onToggleSticky, onFocusTerminal } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'CTRL' }))

    expect(onToggleSticky).toHaveBeenCalledWith('ctrl')
    expect(onFocusTerminal).toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })
})
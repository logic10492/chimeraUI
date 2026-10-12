import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTerminalStickyModifiers } from './Terminal.hooks'

describe('useTerminalStickyModifiers', () => {
  it('toggles sticky modifiers and clears them after a send that consumed them', () => {
    const send = vi.fn()
    const transportSendRef = { current: send }
    const { result } = renderHook(() => useTerminalStickyModifiers(transportSendRef))

    expect(result.current.stickyModifiers).toEqual({ ctrl: false, alt: false })

    act(() => result.current.toggleStickyModifier('ctrl'))
    expect(result.current.stickyModifiers).toEqual({ ctrl: true, alt: false })

    act(() => result.current.sendTerminalData('a'))
    // ctrl sticky transforms 'a' into the Ctrl-A control sequence
    expect(send).toHaveBeenCalledWith('\x01')
    // sticky modifiers are consumed and reset
    expect(result.current.stickyModifiers).toEqual({ ctrl: false, alt: false })

    act(() => result.current.toggleStickyModifier('alt'))
    act(() => result.current.clearStickyModifiers())
    expect(result.current.stickyModifiers).toEqual({ ctrl: false, alt: false })
  })

  it('sends data unchanged when no sticky modifier is active', () => {
    const send = vi.fn()
    const { result } = renderHook(() => useTerminalStickyModifiers({ current: send }))

    act(() => result.current.sendTerminalData('hello'))
    expect(send).toHaveBeenCalledWith('hello')
  })
})
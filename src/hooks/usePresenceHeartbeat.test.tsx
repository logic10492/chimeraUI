import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { reportPresenceMock } = vi.hoisted(() => ({
  reportPresenceMock: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../api/presence', () => ({
  reportPresence: reportPresenceMock,
}))

import { PRESENCE_HEARTBEAT_INTERVAL_MS, usePresenceHeartbeat } from './usePresenceHeartbeat'

describe('usePresenceHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    reportPresenceMock.mockClear()
    reportPresenceMock.mockImplementation(() => Promise.resolve(true))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports immediately on mount and then every heartbeat interval', () => {
    renderHook(() => usePresenceHeartbeat(['/one', '/two']))

    expect(reportPresenceMock).toHaveBeenCalledTimes(1)
    expect(reportPresenceMock).toHaveBeenLastCalledWith(['/one', '/two'])

    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS)
    })
    expect(reportPresenceMock).toHaveBeenCalledTimes(2)

    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS - 1)
    })
    expect(reportPresenceMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the timer when the array reference changes but content is stable', () => {
    const { rerender } = renderHook(({ dirs }: { dirs: string[] }) => usePresenceHeartbeat(dirs), {
      initialProps: { dirs: ['/one', '/two'] },
    })
    expect(reportPresenceMock).toHaveBeenCalledTimes(1)

    // 内容相同（顺序不同 -> 同一 key）：不补报、不重置定时器
    rerender({ dirs: ['/two', '/one'] })
    expect(reportPresenceMock).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS)
    })
    // 周期心跳仍带着最新引用内容上报
    expect(reportPresenceMock).toHaveBeenCalledTimes(2)
    expect(reportPresenceMock).toHaveBeenLastCalledWith(['/two', '/one'])
  })

  it('reports immediately when the directory content changes', () => {
    const { rerender } = renderHook(({ dirs }: { dirs: string[] }) => usePresenceHeartbeat(dirs), {
      initialProps: { dirs: ['/one'] },
    })
    expect(reportPresenceMock).toHaveBeenCalledTimes(1)

    rerender({ dirs: ['/one', '/two'] })
    expect(reportPresenceMock).toHaveBeenCalledTimes(2)
    expect(reportPresenceMock).toHaveBeenLastCalledWith(['/one', '/two'])
  })

  it('stops heartbeating after unmount', () => {
    const { unmount } = renderHook(() => usePresenceHeartbeat(['/one']))
    expect(reportPresenceMock).toHaveBeenCalledTimes(1)

    unmount()
    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS * 3)
    })
    expect(reportPresenceMock).toHaveBeenCalledTimes(1)
  })

  it('swallows heartbeat failures and keeps beating', async () => {
    reportPresenceMock.mockRejectedValueOnce(new Error('offline'))
    renderHook(() => usePresenceHeartbeat(['/one']))

    // flush the rejected promise; the hook must not crash or surface the error
    await act(async () => {
      await Promise.resolve()
    })

    reportPresenceMock.mockClear()
    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS)
    })
    expect(reportPresenceMock).toHaveBeenCalledTimes(1)
  })
})

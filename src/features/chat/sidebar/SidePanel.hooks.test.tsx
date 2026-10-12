import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMissingSessions } from './SidePanel.hooks'

const { getSessionMock, pinnedUpdateMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  pinnedUpdateMock: vi.fn(),
}))

vi.mock('../../../api/session', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}))

vi.mock('../../../store/pinnedSessionsStore', () => ({
  pinnedSessionsStore: {
    update: (...args: unknown[]) => pinnedUpdateMock(...args),
    unpin: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getSnapshot: vi.fn(() => []),
  },
}))

describe('useMissingSessions', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    pinnedUpdateMock.mockReset()
  })

  it('backfills sessions missing from the list and merges them into sessionLookup', async () => {
    getSessionMock.mockResolvedValue({ id: 's1', directory: '/ws' })

    const { result } = renderHook(() =>
      useMissingSessions({
        sessions: [],
        busySessions: [{ sessionId: 's1' }],
        notifications: [],
        pinnedEntries: [],
        selectedSessionId: null,
        currentDirectory: '/ws',
      }),
    )

    await waitFor(() => expect(result.current.sessionLookup.has('s1')).toBe(true))
    expect(getSessionMock).toHaveBeenCalledWith('s1', undefined)
    expect(result.current.sessionLookup.get('s1')?.id).toBe('s1')
  })

  it('marks pinned sessions unavailable when the fetch fails', async () => {
    getSessionMock.mockRejectedValue(new Error('not found'))

    const { result } = renderHook(() =>
      useMissingSessions({
        sessions: [],
        busySessions: [],
        notifications: [],
        pinnedEntries: [{ sessionId: 'p1', directory: '/ws' }],
        selectedSessionId: null,
        currentDirectory: '/ws',
      }),
    )

    await waitFor(() => expect(result.current.unavailablePinnedSessionIds.has('p1')).toBe(true))
  })

  it('does not refetch sessions already present in the list', async () => {
    const existing = { id: 's1', directory: '/ws' } as never

    renderHook(() =>
      useMissingSessions({
        sessions: [existing],
        busySessions: [{ sessionId: 's1' }],
        notifications: [],
        pinnedEntries: [],
        selectedSessionId: null,
        currentDirectory: '/ws',
      }),
    )

    await waitFor(() => expect(getSessionMock).not.toHaveBeenCalled())
  })
})
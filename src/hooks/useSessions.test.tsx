import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'
import { useSessions } from './useSessions'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

const getSessionsMock = vi.fn()
const createSessionMock = vi.fn()
const deleteSessionMock = vi.fn()
const updateSessionMock = vi.fn()
const subscribeToEventsMock = vi.fn()
const onServerChangeMock = vi.fn()
let latestEventCallbacks: Partial<EventCallbacks> = {}
let latestServerChange: (() => void) | undefined

vi.mock('../api', () => ({
  getSessionsPage: async (...args: unknown[]) => {
    const result = await getSessionsMock(...args)
    return Array.isArray(result) ? { items: result } : result
  },
  createSession: (...args: unknown[]) => createSessionMock(...args),
  deleteSession: (...args: unknown[]) => deleteSessionMock(...args),
  updateSession: (...args: unknown[]) => updateSessionMock(...args),
  subscribeToEvents: (...args: unknown[]) => subscribeToEventsMock(...args),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    onServerChange: (...args: unknown[]) => onServerChangeMock(...args),
    getActiveServerId: () => 'server-a',
  },
}))

function makeSession(id: string, directory = '/workspace/demo') {
  return {
    id,
    slug: id,
    projectID: 'project-1',
    directory,
    title: `Session ${id}`,
    version: '1',
    time: {
      created: 1,
      updated: 2,
    },
  }
}

describe('useSessions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getSessionsMock.mockReset()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    updateSessionMock.mockReset()
    subscribeToEventsMock.mockReset()
    onServerChangeMock.mockReset()
    getSessionsMock.mockResolvedValue([])
    createSessionMock.mockResolvedValue(makeSession('new'))
    deleteSessionMock.mockResolvedValue(true)
    updateSessionMock.mockResolvedValue(makeSession('updated'))
    latestEventCallbacks = {}
    latestServerChange = undefined
    subscribeToEventsMock.mockImplementation((callbacks: EventCallbacks) => {
      latestEventCallbacks = callbacks
      return vi.fn()
    })
    onServerChangeMock.mockImplementation(listener => {
      latestServerChange = listener as () => void
      return vi.fn()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for enabled before fetching', async () => {
    const { rerender } = renderHook(({ enabled }) => useSessions({ directory: '/workspace/demo', enabled }), {
      initialProps: { enabled: false },
    })

    expect(getSessionsMock).not.toHaveBeenCalled()

    rerender({ enabled: true })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledWith({
      roots: true,
      limit: 20,
      directory: '/workspace/demo',
    })
  })

  it('loads the next fixed-size page with the server cursor and appends without duplicates', async () => {
    getSessionsMock
      .mockResolvedValueOnce({
        items: [makeSession('session-2'), makeSession('session-1')],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [makeSession('session-1'), makeSession('session-0')],
      })

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo', pageSize: 2 }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.loadMore()
    })

    expect(getSessionsMock).toHaveBeenNthCalledWith(2, {
      roots: true,
      limit: 2,
      directory: '/workspace/demo',
      cursor: 'cursor-1',
    })
    expect(result.current.sessions.map(session => session.id)).toEqual(['session-2', 'session-1', 'session-0'])
    expect(result.current.hasMore).toBe(false)
  })

  it('passes the scoped directory when removing a session', async () => {
    getSessionsMock.mockResolvedValue([makeSession('session-1')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(result.current.sessions).toHaveLength(1)

    await act(async () => {
      await result.current.remove('session-1')
    })

    expect(deleteSessionMock).toHaveBeenCalledWith('session-1', '/workspace/demo')
  })

  it('loads archived sessions and removes restored sessions from the archived view', async () => {
    const archivedSession = { ...makeSession('archived'), time: { created: 1, updated: 2, archived: 3 } }
    getSessionsMock.mockResolvedValue([archivedSession])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo', archived: true }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledWith({
      roots: true,
      limit: 20,
      directory: '/workspace/demo',
      archived: true,
    })

    await act(async () => {
      await result.current.restore('archived')
    })

    expect(updateSessionMock).toHaveBeenCalledWith('archived', { time: { archived: null } }, '/workspace/demo')
    expect(result.current.sessions).toEqual([])
  })

  it('treats restored events with archived null as active sessions', async () => {
    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    await act(async () => {
      latestEventCallbacks.onSessionUpdated?.({
        ...makeSession('restored'),
        time: { created: 1, updated: 2, archived: null },
      } as unknown as Parameters<NonNullable<EventCallbacks['onSessionUpdated']>>[0])
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['restored'])
  })

  it('adds matching sessions from realtime events immediately', async () => {
    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    await act(async () => {
      latestEventCallbacks.onSessionCreated?.(makeSession('session-1'))
      latestEventCallbacks.onSessionCreated?.(makeSession('session-ignored', '/workspace/other'))
      latestEventCallbacks.onSessionCreated?.({ ...makeSession('session-child'), parentID: 'parent-1' })
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-1'])
  })

  it('queues a reconnect refresh while a newer request is still in flight', async () => {
    const firstRequest = createDeferred<ReturnType<typeof makeSession>[]>()
    const secondRequest = createDeferred<ReturnType<typeof makeSession>[]>()
    const thirdRequest = createDeferred<ReturnType<typeof makeSession>[]>()

    getSessionsMock
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)
      .mockImplementationOnce(() => thirdRequest.promise)

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    act(() => {
      result.current.setSearch('branch')
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    await act(async () => {
      firstRequest.resolve([makeSession('session-1')])
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      latestEventCallbacks.onReconnected?.('network')
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      secondRequest.resolve([makeSession('session-2')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(3)

    await act(async () => {
      thirdRequest.resolve([makeSession('session-3')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['session-3'])
  })

  it('retries the initial fetch after a startup failure', async () => {
    getSessionsMock
      .mockRejectedValueOnce(new Error('service not ready'))
      .mockResolvedValueOnce([makeSession('session-1')])

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runOnlyPendingTimers()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)
    expect(result.current.sessions.map(session => session.id)).toEqual(['session-1'])
  })

  it('refetches on server endpoint changes even while the old request is in flight', async () => {
    const staleRequest = createDeferred<ReturnType<typeof makeSession>[]>()
    const freshRequest = createDeferred<ReturnType<typeof makeSession>[]>()

    getSessionsMock
      .mockImplementationOnce(() => staleRequest.promise)
      .mockImplementationOnce(() => freshRequest.promise)

    const { result } = renderHook(() => useSessions({ directory: '/workspace/demo' }))

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      latestServerChange?.()
      await Promise.resolve()
    })

    expect(getSessionsMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      freshRequest.resolve([makeSession('fresh')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['fresh'])

    await act(async () => {
      staleRequest.resolve([makeSession('stale')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.sessions.map(session => session.id)).toEqual(['fresh'])
  })
})

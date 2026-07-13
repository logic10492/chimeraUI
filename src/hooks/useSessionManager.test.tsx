import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionManager } from './useSessionManager'

const { getSessionMock, getSessionMessagesMock, messageStoreMock, sessionErrorHandlerMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getSessionMessagesMock: vi.fn(),
  messageStoreMock: {
    getSessionState: vi.fn(),
    setLoadState: vi.fn(),
    setLoadError: vi.fn(),
    setMessages: vi.fn(),
    updateSessionMetadata: vi.fn(),
    prependMessages: vi.fn(),
    setRevertState: vi.fn(),
  },
  sessionErrorHandlerMock: vi.fn(),
}))

vi.mock('../api', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionMessagesPage: (...args: unknown[]) => getSessionMessagesMock(...args),
  revertMessage: vi.fn(),
  unrevertSession: vi.fn(),
  extractUserMessageContent: vi.fn(),
}))

vi.mock('../store', () => ({
  messageStore: messageStoreMock,
}))

vi.mock('../utils', () => ({
  sessionErrorHandler: (...args: unknown[]) => sessionErrorHandlerMock(...args),
}))

describe('useSessionManager', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    getSessionMessagesMock.mockReset()
    messageStoreMock.getSessionState.mockReset()
    messageStoreMock.setLoadState.mockReset()
    messageStoreMock.setLoadError.mockReset()
    messageStoreMock.setMessages.mockReset()
    messageStoreMock.updateSessionMetadata.mockReset()
    messageStoreMock.prependMessages.mockReset()
    messageStoreMock.setRevertState.mockReset()
    sessionErrorHandlerMock.mockReset()

    messageStoreMock.getSessionState.mockReturnValue(null)
    getSessionMock.mockResolvedValue({ id: 'session-1', directory: '/workspace/demo' })
    getSessionMessagesMock.mockResolvedValue({ items: [] })
  })

  it('reports missing route sessions when loading returns not found', async () => {
    const onSessionMissing = vi.fn()
    const notFoundError = Object.assign(new Error('session not found'), { status: 404 })
    getSessionMock.mockRejectedValue(notFoundError)
    getSessionMessagesMock.mockRejectedValue(notFoundError)

    renderHook(() =>
      useSessionManager({
        sessionId: 'missing-session',
        directory: '/workspace/demo',
        onSessionMissing,
      }),
    )

    await waitFor(() => {
      expect(onSessionMissing).toHaveBeenCalledWith('missing-session')
    })

    expect(messageStoreMock.setLoadState).toHaveBeenCalledWith('missing-session', 'loading')
    expect(messageStoreMock.setLoadError).toHaveBeenCalledWith(
      'missing-session',
      expect.objectContaining({ name: 'APIError' }),
    )
  })

  it('loads older history with a fixed page size and the opaque cursor', async () => {
    const existing = { info: { id: 'message-2', time: { created: 2 } }, parts: [] }
    const older = { info: { id: 'message-1', time: { created: 1 } }, parts: [] }
    const state = {
      messages: [existing],
      loadState: 'loaded',
      isStale: false,
      isStreaming: false,
      directory: '/workspace/demo',
    }
    messageStoreMock.getSessionState.mockReturnValue(state)
    getSessionMessagesMock
      .mockResolvedValueOnce({ items: [existing], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [older] })

    const { result } = renderHook(() => useSessionManager({ sessionId: 'session-1', directory: '/workspace/demo' }))

    await waitFor(() => {
      expect(getSessionMessagesMock).toHaveBeenCalledTimes(1)
    })

    await result.current.loadMoreHistory()

    expect(getSessionMessagesMock).toHaveBeenNthCalledWith(2, 'session-1', 50, '/workspace/demo', {
      before: 'cursor-1',
    })
    expect(messageStoreMock.prependMessages).toHaveBeenCalledWith('session-1', [older], false)
  })
})

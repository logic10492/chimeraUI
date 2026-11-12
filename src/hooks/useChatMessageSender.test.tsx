import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatMessageSender } from './useChatMessageSender'

const { getSessionStateMock, getSessionMessagesMock, handleMessageUpdatedMock, sendMessageAsyncMock } = vi.hoisted(() => ({
  getSessionStateMock: vi.fn(),
  getSessionMessagesMock: vi.fn(),
  handleMessageUpdatedMock: vi.fn(),
  sendMessageAsyncMock: vi.fn(),
}))

vi.mock('../store/messageStore', () => ({
  messageStore: {
    getSessionState: getSessionStateMock,
    setStreaming: vi.fn(),
    createSendRollbackSnapshot: vi.fn(() => null),
    truncateAfterRevert: vi.fn(),
    restoreSendRollback: vi.fn(),
    handleMessageUpdated: handleMessageUpdatedMock,
    handlePartUpdated: vi.fn(),
    removeMessage: vi.fn(),
    upsertLocalMessage: vi.fn(),
  },
}))

vi.mock('../store/followupQueueStore', () => ({
  followupQueueStore: {
    enqueue: vi.fn(),
    getItem: vi.fn(),
    startSending: vi.fn(),
    remove: vi.fn(),
    markFailed: vi.fn(),
  },
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: vi.fn(() => 'local'),
  },
}))

vi.mock('../api/message', () => ({
  sendMessageAsync: sendMessageAsyncMock,
  getSessionMessages: getSessionMessagesMock,
}))

vi.mock('../utils/sessionLifecycle', () => ({
  clearSessionRuntimeState: vi.fn(),
}))

vi.mock('../utils', () => ({
  createErrorHandler: () => vi.fn(),
}))

describe('useChatMessageSender fallback reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    sendMessageAsyncMock.mockResolvedValue(undefined)
    getSessionStateMock.mockReturnValue(undefined)
    getSessionMessagesMock.mockResolvedValue([
      {
        info: { id: 'msg_user', role: 'user', sessionID: 'ses_new' },
        parts: [{ id: 'prt_text', type: 'text', text: 'hello', sessionID: 'ses_new', messageID: 'msg_user' }],
      },
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pulls the first user message even when the new session has no store state yet', async () => {
    const { result } = renderHook(() =>
      useChatMessageSender({
        routeSessionId: 'ses_new',
        effectiveDirectory: '/repo',
        currentModel: { providerId: 'test', id: 'model' } as never,
        isSessionBusy: false,
        queuedFollowups: [],
        queuedFollowupSendingId: undefined,
        queuedFollowupFailedId: undefined,
        queueFollowupMessages: false,
        navigateToSession: vi.fn(),
        createSession: vi.fn(),
        setRestoredContent: vi.fn(),
      }),
    )

    let resolveSend!: () => void
    sendMessageAsyncMock.mockImplementation(() => {
      const { promise, resolve } = Promise.withResolvers<void>()
      resolveSend = resolve
      return promise
    })
    const sendPromise = result.current.handleSend('hello', [])
    expect(getSessionMessagesMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(getSessionMessagesMock).toHaveBeenCalledWith('ses_new', 5, '/repo')
    expect(handleMessageUpdatedMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg_user', role: 'user' }))
    await act(async () => {
      resolveSend()
      expect(await sendPromise).toBe(true)
    })
  })
})

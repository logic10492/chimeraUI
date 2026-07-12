import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePermissionHandler } from './usePermissionHandler'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => {
    resolve = next
  })
  return { promise, resolve }
}

const {
  replyPermissionMock,
  replyQuestionMock,
  rejectQuestionMock,
  getPendingPermissionsMock,
  getPendingQuestionsMock,
  activeSessionStoreMock,
} = vi.hoisted(() => ({
  replyPermissionMock: vi.fn(() => Promise.resolve(true)),
  replyQuestionMock: vi.fn(() => Promise.resolve(true)),
  rejectQuestionMock: vi.fn(() => Promise.resolve(true)),
  getPendingPermissionsMock: vi.fn(() => Promise.resolve([])),
  getPendingQuestionsMock: vi.fn(() => Promise.resolve([])),
  activeSessionStoreMock: {
    resolvePendingRequest: vi.fn(),
  },
}))

vi.mock('../api', () => ({
  replyPermission: replyPermissionMock,
  replyQuestion: replyQuestionMock,
  rejectQuestion: rejectQuestionMock,
  getPendingPermissions: getPendingPermissionsMock,
  getPendingQuestions: getPendingQuestionsMock,
}))

vi.mock('../store', () => ({
  activeSessionStore: activeSessionStoreMock,
}))

vi.mock('../utils', () => ({
  permissionErrorHandler: vi.fn(),
}))

describe('usePermissionHandler', () => {
  beforeEach(() => {
    replyPermissionMock.mockReset()
    replyPermissionMock.mockResolvedValue(true)
    getPendingPermissionsMock.mockReset()
    getPendingPermissionsMock.mockResolvedValue([])
    activeSessionStoreMock.resolvePendingRequest.mockClear()
    replyQuestionMock.mockReset()
    replyQuestionMock.mockResolvedValue(true)
    rejectQuestionMock.mockReset()
    rejectQuestionMock.mockResolvedValue(true)
    getPendingQuestionsMock.mockReset()
    getPendingQuestionsMock.mockResolvedValue([])
  })

  it('clears pending permission locally after a successful reply', async () => {
    const { result } = renderHook(() => usePermissionHandler())

    act(() => {
      result.current.setPendingPermissionRequests([
        {
          id: 'perm-1',
          sessionID: 'session-1',
          permission: 'bash',
          patterns: ['npm test'],
          metadata: {},
          always: [],
        },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handlePermissionReply('perm-1', 'once', '/workspace', 'session-1')
    })

    expect(success).toBe(true)
    expect(replyPermissionMock).toHaveBeenCalledWith('perm-1', 'once', undefined, '/workspace', 'session-1')
    expect(result.current.pendingPermissionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-1')
  })

  it('clears stale permission when reply fails but server no longer lists it as pending', async () => {
    replyPermissionMock.mockRejectedValue(new Error('permission already handled'))
    getPendingPermissionsMock.mockResolvedValue([])
    const { result } = renderHook(() => usePermissionHandler())

    act(() => {
      result.current.setPendingPermissionRequests([
        {
          id: 'perm-stale',
          sessionID: 'session-1',
          permission: 'bash',
          patterns: ['npm test'],
          metadata: {},
          always: [],
        },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handlePermissionReply('perm-stale', 'once', '/workspace', 'session-1')
    })

    expect(success).toBe(true)
    expect(getPendingPermissionsMock).toHaveBeenCalledWith('session-1', '/workspace')
    expect(result.current.pendingPermissionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-stale')
  })

  it('keeps and refreshes a question when reply fails and the server still lists it', async () => {
    replyQuestionMock.mockRejectedValue(new Error('temporary failure'))
    const refreshedQuestion = {
      id: 'question-1',
      sessionID: 'session-1',
      questions: [{ question: 'Updated?', header: 'Question', options: [], multiple: false }],
    }
    getPendingQuestionsMock.mockResolvedValue([refreshedQuestion])
    const { result } = renderHook(() => usePermissionHandler())

    act(() => {
      result.current.setPendingQuestionRequests([{ ...refreshedQuestion, questions: [] }])
    })

    let success = true
    await act(async () => {
      success = await result.current.handleQuestionReply('question-1', [['yes']], '/workspace')
    })

    expect(success).toBe(false)
    expect(getPendingQuestionsMock).toHaveBeenCalledWith(undefined, '/workspace')
    expect(result.current.pendingQuestionRequests).toEqual([refreshedQuestion])
    expect(activeSessionStoreMock.resolvePendingRequest).not.toHaveBeenCalledWith('question-1')
  })

  it('removes a question only when reject failure reconciliation confirms it is gone', async () => {
    rejectQuestionMock.mockRejectedValue(new Error('already handled'))
    getPendingQuestionsMock.mockResolvedValue([])
    const { result } = renderHook(() => usePermissionHandler())
    const question = {
      id: 'question-stale',
      sessionID: 'session-1',
      questions: [{ question: 'Continue?', header: 'Question', options: [], multiple: false }],
    }

    act(() => {
      result.current.setPendingQuestionRequests([question])
    })

    let success = false
    await act(async () => {
      success = await result.current.handleQuestionReject('question-stale', '/workspace')
    })

    expect(success).toBe(true)
    expect(result.current.pendingQuestionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('question-stale')
  })
  it('ignores an old pending refresh after the request scope resets', async () => {
    const pendingQuestions = createDeferred<
      Array<{
        id: string
        sessionID: string
        questions: Array<{ question: string; header: string; options: never[]; multiple: boolean }>
      }>
    >()
    getPendingQuestionsMock.mockReturnValueOnce(pendingQuestions.promise)
    const { result } = renderHook(() => usePermissionHandler())
    const currentQuestion = {
      id: 'question-current',
      sessionID: 'session-current',
      questions: [{ question: 'Current?', header: 'Question', options: [], multiple: false }],
    }

    const refresh = result.current.refreshPendingRequests('session-old', '/workspace/old')
    act(() => {
      result.current.resetPendingRequests()
      result.current.setPendingQuestionRequests([currentQuestion])
    })

    await act(async () => {
      pendingQuestions.resolve([
        {
          id: 'question-old',
          sessionID: 'session-old',
          questions: [{ question: 'Old?', header: 'Question', options: [], multiple: false }],
        },
      ])
      await refresh
    })

    expect(result.current.pendingQuestionRequests).toEqual([currentQuestion])
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatSession } from './useChatSession'

const {
  createSessionMock,
  summarizeSessionMock,
  executeCommandMock,
  getSelectableAgentsMock,
  registerSessionConsumerMock,
  updateConsumerSessionIdMock,
  sendNotificationMock,
  isSystemEnabledMock,
  errorHandlerMock,
  getPaneFullAutoModeMock,
  onFullAutoChangeMock,
  autoApproveSubscribeMock,
  shouldAutoApproveMock,
  claimAutoReplyMock,
  releaseAutoReplyMock,
  useSessionFamilyMock,
  pendingPermissionRequestsMock,
  handlePermissionReplyMock,
  refreshPendingRequestsMock,
  getSessionMetaMock,
  childLoadChildrenMock,
  getPendingPermissionsMock,
  getPendingQuestionsMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  summarizeSessionMock: vi.fn(),
  executeCommandMock: vi.fn(),
  getSelectableAgentsMock: vi.fn(),
  registerSessionConsumerMock: vi.fn(),
  updateConsumerSessionIdMock: vi.fn(),
  sendNotificationMock: vi.fn(),
  isSystemEnabledMock: vi.fn((type: string) => type !== 'permission'),
  errorHandlerMock: vi.fn(),
  getPaneFullAutoModeMock: vi.fn((_paneId: string) => 'off'),
  onFullAutoChangeMock: vi.fn((_listener: unknown) => vi.fn()),
  autoApproveSubscribeMock: vi.fn((_listener: unknown) => vi.fn()),
  shouldAutoApproveMock: vi.fn((_sessionId: string, _permission: string, _patterns: string[]) => false),
  claimAutoReplyMock: vi.fn((_requestId: string) => true),
  releaseAutoReplyMock: vi.fn((_requestId: string) => undefined),
  useSessionFamilyMock: vi.fn((_sessionId: string | null) => [] as string[]),
  pendingPermissionRequestsMock: [] as Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>,
  handlePermissionReplyMock: vi.fn(
    (_requestId: string, _reply: string, _directory?: string, _sessionId?: string) => Promise.resolve(true),
  ),
  refreshPendingRequestsMock: vi.fn((_sessionIds?: string | string[], _directory?: string) => Promise.resolve()),
  getSessionMetaMock: vi.fn((_sessionId?: string, _serverID?: string) => undefined as { directory?: string } | undefined),
  childLoadChildrenMock: vi.fn(() => Promise.resolve([] as never[])),
  getPendingPermissionsMock: vi.fn(() => Promise.resolve([] as never[])),
  getPendingQuestionsMock: vi.fn(() => Promise.resolve([] as never[])),
}))

const autoApproveState = vi.hoisted(() => ({
  approvePendingOnFullAuto: false,
}))

const directoryState = vi.hoisted(() => ({
  currentDirectory: '/workspace/demo',
}))

vi.mock('../store', () => ({
  messageStore: {
    markAllSessionsStale: vi.fn(),
    getSessionState: vi.fn(() => ({ messages: [] })),
    setStreaming: vi.fn(),
    createSendRollbackSnapshot: vi.fn(),
    truncateAfterRevert: vi.fn(),
    restoreSendRollback: vi.fn(),
    handleMessageUpdated: vi.fn(),
    handlePartUpdated: vi.fn(),
  },
  useSessionFamily: (sessionId: string | null) => useSessionFamilyMock(sessionId),
  useSessionState: () => null,
  autoApproveStore: {
    getPaneFullAutoMode: (paneId: string) => getPaneFullAutoModeMock(paneId),
    onFullAutoChange: (listener: unknown) => onFullAutoChangeMock(listener),
    subscribe: (listener: unknown) => autoApproveSubscribeMock(listener),
    get approvePendingOnFullAuto() {
      return autoApproveState.approvePendingOnFullAuto
    },
    enabled: false,
    shouldAutoApprove: (sessionId: string, permission: string, patterns: string[]) =>
      shouldAutoApproveMock(sessionId, permission, patterns),
    claimAutoReply: (requestId: string) => claimAutoReplyMock(requestId),
    releaseAutoReply: (requestId: string) => releaseAutoReplyMock(requestId),
  },
  childSessionStore: {
    getChildSessionIds: vi.fn(() => []),
    registerChildSession: vi.fn(),
    getSessionAndDescendants: vi.fn(() => []),
    loadChildren: (...args: [string, string?]) => childLoadChildrenMock(...args),
  },
  useActiveSessionStore: () => ({ statusMap: {} }),
}))

vi.mock('../store/activeSessionStore', () => ({
  activeSessionStore: {
    getSessionMeta: (...args: [string?, string?]) => getSessionMetaMock(...args),
    removeSession: vi.fn(),
  },
}))

vi.mock('../hooks', () => ({
  useSessionManager: () => ({
    loadSession: vi.fn(),
    loadMoreHistory: vi.fn(),
    handleUndo: vi.fn(),
    handleRedo: vi.fn(),
    handleRedoAll: vi.fn(),
    clearRevert: vi.fn(),
  }),
  registerSessionConsumer: (...args: unknown[]) => registerSessionConsumerMock(...args),
  updateConsumerSessionId: (...args: unknown[]) => updateConsumerSessionIdMock(...args),
  hasOtherConsumerForSession: vi.fn(() => false),
  usePermissions: () => ({ resetPermissions: vi.fn() }),
  usePermissionHandler: () => ({
    pendingPermissionRequests: pendingPermissionRequestsMock,
    pendingQuestionRequests: [],
    setPendingPermissionRequests: vi.fn(),
    setPendingQuestionRequests: vi.fn(),
    handlePermissionReply: handlePermissionReplyMock,
    handleQuestionReply: vi.fn(),
    handleQuestionReject: vi.fn(),
    refreshPendingRequests: refreshPendingRequestsMock,
    resetPendingRequests: vi.fn(),
    isReplying: false,
  }),
  useMessageAnimation: () => ({
    registerMessage: vi.fn(),
    registerInputBox: vi.fn(),
    animateUndo: vi.fn(),
    animateRedo: vi.fn(),
  }),
  useDirectory: () => ({ currentDirectory: directoryState.currentDirectory }),
  useSessionContext: () => ({
    createSession: createSessionMock,
    sessions: [],
  }),
}))

vi.mock('./useNotification', () => ({
  useNotification: () => ({ sendNotification: sendNotificationMock }),
}))

vi.mock('../store/notificationEventSettingsStore', () => ({
  notificationEventSettingsStore: {
    isSystemEnabled: (type: string) => isSystemEnabledMock(type),
  },
}))

vi.mock('../api', () => ({
  sendMessageAsync: vi.fn(),
  getSessionMessages: vi.fn(),
  abortSession: vi.fn(),
  getSelectableAgents: (...args: unknown[]) => getSelectableAgentsMock(...args),
  getPendingPermissions: (...args: [string?, string?]) => getPendingPermissionsMock(...args),
  getPendingQuestions: (...args: [string?, string?]) => getPendingQuestionsMock(...args),
  prefetchCommands: vi.fn(() => Promise.resolve()),
  prefetchRootDirectory: vi.fn(() => Promise.resolve()),
  getSessionChildren: vi.fn(() => Promise.resolve([])),
  executeCommand: (...args: unknown[]) => executeCommandMock(...args),
  summarizeSession: (...args: unknown[]) => summarizeSessionMock(...args),
  updateSession: vi.fn(),
  forkSession: vi.fn(),
  extractUserMessageContent: vi.fn(),
}))

vi.mock('../utils', () => ({
  clipboardErrorHandler: vi.fn(),
  copyTextToClipboard: vi.fn(),
  createErrorHandler: vi.fn(() => errorHandlerMock),
}))

vi.mock('../utils/perServerStorage', () => ({
  serverStorage: {
    get: vi.fn(() => 'build'),
    set: vi.fn(),
  },
}))

describe('useChatSession handleCommand', () => {
  beforeEach(() => {
    createSessionMock.mockReset()
    summarizeSessionMock.mockReset()
    executeCommandMock.mockReset()
    getSelectableAgentsMock.mockReset()
    registerSessionConsumerMock.mockReset()
    updateConsumerSessionIdMock.mockReset()
    sendNotificationMock.mockReset()
    isSystemEnabledMock.mockReset()
    errorHandlerMock.mockReset()
    getPaneFullAutoModeMock.mockReset()
    onFullAutoChangeMock.mockReset()
    autoApproveSubscribeMock.mockReset()
    shouldAutoApproveMock.mockReset()
    claimAutoReplyMock.mockReset()
    releaseAutoReplyMock.mockReset()
    useSessionFamilyMock.mockReset()
    handlePermissionReplyMock.mockReset()
    refreshPendingRequestsMock.mockReset()
    pendingPermissionRequestsMock.length = 0

    registerSessionConsumerMock.mockReturnValue(vi.fn())
    getPaneFullAutoModeMock.mockReturnValue('off')
    onFullAutoChangeMock.mockReturnValue(vi.fn())
    autoApproveSubscribeMock.mockReturnValue(vi.fn())
    shouldAutoApproveMock.mockReturnValue(false)
    claimAutoReplyMock.mockReturnValue(true)
    useSessionFamilyMock.mockReturnValue([])
    handlePermissionReplyMock.mockResolvedValue(true)
    refreshPendingRequestsMock.mockResolvedValue(undefined)
    autoApproveState.approvePendingOnFullAuto = false
    getSelectableAgentsMock.mockResolvedValue([{ name: 'build', mode: 'primary', hidden: false }])
    isSystemEnabledMock.mockImplementation((type: string) => type !== 'permission')

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => window.setTimeout(() => cb(0), 16))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('treats compact as sent before summarize finishes', async () => {
    summarizeSessionMock.mockReturnValue(new Promise<boolean>(() => {}))

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    let settled = false
    let commandResult: boolean | undefined

    await act(async () => {
      const promise = result.current.handleCommand('/compact')
      promise.then(value => {
        settled = true
        commandResult = value
      })
      await Promise.resolve()
    })

    expect(summarizeSessionMock).toHaveBeenCalledWith(
      'session-1',
      { providerID: 'provider-1', modelID: 'model-1' },
      '/workspace/demo',
    )
    expect(settled).toBe(true)
    expect(commandResult).toBe(true)
  })

  it('treats api commands as sent before execution finishes', async () => {
    executeCommandMock.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    let settled = false
    let commandResult: boolean | undefined

    await act(async () => {
      const promise = result.current.handleCommand('/review src/App.tsx')
      promise.then(value => {
        settled = true
        commandResult = value
      })
      await Promise.resolve()
    })

    expect(executeCommandMock).toHaveBeenCalledWith('session-1', 'review', 'src/App.tsx', '/workspace/demo')
    expect(settled).toBe(true)
    expect(commandResult).toBe(true)
  })

  it('refreshes pending permissions when session full auto pending sweep is enabled', async () => {
    getPaneFullAutoModeMock.mockReturnValue('session')
    autoApproveState.approvePendingOnFullAuto = true
    useSessionFamilyMock.mockReturnValue(['session-1', 'child-session'])

    renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(refreshPendingRequestsMock).toHaveBeenCalledWith(['session-1', 'child-session'], '/workspace/demo')
    })
  })

  it('approves already pending permissions when session full auto pending sweep is enabled', async () => {
    getPaneFullAutoModeMock.mockReturnValue('session')
    autoApproveState.approvePendingOnFullAuto = true
    pendingPermissionRequestsMock.push({
      id: 'perm-1',
      sessionID: 'session-1',
      permission: 'bash',
      patterns: ['npm test'],
    })

    renderHook(() =>
      useChatSession({
        paneId: 'pane-1',
        chatAreaRef: { current: null },
        currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
        refetchModels: vi.fn(async () => {}),
        sessionId: 'session-1',
        navigateToSession: vi.fn(),
        navigateHome: vi.fn(),
      }),
    )

    await waitFor(() => {
      expect(claimAutoReplyMock).toHaveBeenCalledWith('perm-1')
      expect(handlePermissionReplyMock).toHaveBeenCalledWith('perm-1', 'once', '/workspace/demo', 'session-1')
    })
  })

  it.each([
    {
      disabledType: 'permission',
      trigger: 'onPermissionAsked',
      payload: { id: 'perm-1', sessionID: 'session-1', permission: 'bash', patterns: [] },
    },
    {
      disabledType: 'question',
      trigger: 'onQuestionAsked',
      payload: {
        id: 'question-1',
        sessionID: 'session-1',
        questions: [{ header: 'Need input' }],
      },
    },
    {
      disabledType: 'completed',
      trigger: 'onSessionIdle',
      payload: 'session-1',
    },
    {
      disabledType: 'error',
      trigger: 'onSessionError',
      payload: 'session-1',
    },
  ])(
    'does not send browser notification when the $disabledType event is disabled',
    async ({ disabledType, trigger, payload }) => {
      let callbacks: Record<string, ((payload: unknown) => void) | undefined> | undefined
      registerSessionConsumerMock.mockImplementation((_paneId, _sessionId, consumerCallbacks) => {
        callbacks = consumerCallbacks as typeof callbacks
        return vi.fn()
      })
      isSystemEnabledMock.mockImplementation((type: string) => type !== disabledType)

      renderHook(() =>
        useChatSession({
          paneId: 'pane-1',
          chatAreaRef: { current: null },
          currentModel: { id: 'model-1', providerId: 'provider-1', variants: [] } as never,
          refetchModels: vi.fn(async () => {}),
          sessionId: 'session-1',
          navigateToSession: vi.fn(),
          navigateHome: vi.fn(),
        }),
      )

      act(() => {
        callbacks?.[trigger]?.(payload)
      })

      expect(sendNotificationMock).not.toHaveBeenCalled()
    },
  )
})

describe('useChatSession children/permissions loading (W3③)', () => {
  beforeEach(() => {
    getSessionMetaMock.mockReset()
    getSessionMetaMock.mockReturnValue(undefined)
    childLoadChildrenMock.mockReset()
    childLoadChildrenMock.mockResolvedValue([])
    getPendingPermissionsMock.mockReset()
    getPendingPermissionsMock.mockResolvedValue([])
    getPendingQuestionsMock.mockReset()
    getPendingQuestionsMock.mockResolvedValue([])
    getSelectableAgentsMock.mockReset()
    getSelectableAgentsMock.mockResolvedValue([])
    registerSessionConsumerMock.mockReset()
    registerSessionConsumerMock.mockReturnValue(vi.fn())
    useSessionFamilyMock.mockReset()
    useSessionFamilyMock.mockReturnValue([])
    getPaneFullAutoModeMock.mockReset()
    getPaneFullAutoModeMock.mockReturnValue('off')
    onFullAutoChangeMock.mockReset()
    onFullAutoChangeMock.mockReturnValue(vi.fn())
    autoApproveSubscribeMock.mockReset()
    autoApproveSubscribeMock.mockReturnValue(vi.fn())
    autoApproveState.approvePendingOnFullAuto = false
    directoryState.currentDirectory = '/workspace/demo'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderChatSession(sessionId: string | null, options?: { wrapper?: React.ComponentType<{ children: React.ReactNode }> }) {
    return renderHook(
      () =>
        useChatSession({
          paneId: 'pane-1',
          chatAreaRef: { current: null },
          currentModel: undefined,
          refetchModels: vi.fn(async () => {}),
          sessionId,
          navigateToSession: vi.fn(),
          navigateHome: vi.fn(),
        }),
      options,
    )
  }

  it('waits for effectiveDirectory to catch up with the known session directory', async () => {
    // 跨项目切换中：session 元数据已知目标目录，但 currentDirectory 还停在旧项目
    getSessionMetaMock.mockReturnValue({ directory: '/workspace/target' })
    directoryState.currentDirectory = '/workspace/stale'

    const { rerender } = renderChatSession('session-1')

    await act(async () => {
      await Promise.resolve()
    })

    // 目录未就绪：不用旧目录白跑一遍（0 次权限/问题/children 拉取）
    expect(getPendingPermissionsMock).not.toHaveBeenCalled()
    expect(getPendingQuestionsMock).not.toHaveBeenCalled()
    expect(childLoadChildrenMock).not.toHaveBeenCalled()

    // 路由追上后 → 只拉取一次，且用正确目录
    directoryState.currentDirectory = '/workspace/target'
    rerender()

    await waitFor(() => expect(getPendingPermissionsMock).toHaveBeenCalledTimes(1))
    expect(getPendingPermissionsMock).toHaveBeenCalledWith(undefined, '/workspace/target')
    expect(getPendingQuestionsMock).toHaveBeenCalledTimes(1)
    expect(childLoadChildrenMock).toHaveBeenCalledTimes(1)
    expect(childLoadChildrenMock).toHaveBeenCalledWith('session-1', '/workspace/target')

    // 已完成组合的重复 effect（依赖拖动）不再重拉
    rerender()
    rerender()
    await act(async () => {
      await Promise.resolve()
    })
    expect(getPendingPermissionsMock).toHaveBeenCalledTimes(1)
  })

  it('fetches permissions only once under StrictMode double effect invocation', async () => {
    getSessionMetaMock.mockReturnValue(undefined)

    renderChatSession('session-1', { wrapper: StrictMode })

    await waitFor(() => expect(getPendingPermissionsMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // StrictMode 双跑：第一次被 cleanup 取消，仅第二次真正拉取
    expect(getPendingPermissionsMock).toHaveBeenCalledTimes(1)
    expect(getPendingQuestionsMock).toHaveBeenCalledTimes(1)
  })
})

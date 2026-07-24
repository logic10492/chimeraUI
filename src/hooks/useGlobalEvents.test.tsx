import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSessionConsumer, useGlobalEvents } from './useGlobalEvents'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

const TEST_SCOPE = { serverID: 'local', directory: '/workspace' } as const
const GLOBAL_SCOPE = { serverID: 'local', directory: 'global' } as const

const {
  subscribeToEventsMock,
  getSessionStatusMock,
  getPendingPermissionsMock,
  getPendingQuestionsMock,
  replyPermissionMock,
  childBelongsToSessionMock,
  getFocusedSessionIdMock,
  getSessionAndDescendantsMock,
  notificationPushMock,
  playNotificationSoundDedupedMock,
  getSoundSnapshotMock,
  isSystemEnabledMock,
  activeSessionStoreMock,
  applyServerConnectedTimestampMock,
  getActiveServerIdMock,
  checkHealthMock,
  onServerChangeMock,
  autoApproveStoreMock,
  clearSessionRuntimeStateMock,
  clearPaneSessionMock,
  messageRemoveMock,
  markAllSessionsStaleMock,
  runtimeInvalidationEmitMock,
  invalidateRootDirectoryCacheMock,
  sendNotificationMock,
} = vi.hoisted(() => ({
  subscribeToEventsMock: vi.fn(),
  getSessionStatusMock: vi.fn<
    (scope?: { serverID: string; directory?: string; workspace?: string }) => Promise<Record<string, { type: string }>>
  >(() => Promise.resolve({})),
  getPendingPermissionsMock: vi.fn(() =>
    Promise.resolve([] as Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>),
  ),
  getPendingQuestionsMock: vi.fn(() => Promise.resolve([])),
  replyPermissionMock: vi.fn(() => Promise.resolve()),
  childBelongsToSessionMock: vi.fn<(sessionId: string, rootSessionId: string) => boolean>(() => false),
  getFocusedSessionIdMock: vi.fn<() => string | null>(() => null),
  getSessionAndDescendantsMock: vi.fn((sessionId: string) => [sessionId]),
  notificationPushMock: vi.fn(),
  playNotificationSoundDedupedMock: vi.fn(),
  isSystemEnabledMock: vi.fn((type: string) => type !== 'permission'),
  applyServerConnectedTimestampMock: vi.fn(),
  getActiveServerIdMock: vi.fn(() => 'local'),
  checkHealthMock: vi.fn(() => Promise.resolve({ status: 'online' })),
  onServerChangeMock: vi.fn((_listener: (serverId: string) => void) => vi.fn()),
  clearSessionRuntimeStateMock: vi.fn(),
  clearPaneSessionMock: vi.fn(),
  messageRemoveMock: vi.fn(),
  markAllSessionsStaleMock: vi.fn(),
  runtimeInvalidationEmitMock: vi.fn(),
  invalidateRootDirectoryCacheMock: vi.fn(),
  sendNotificationMock: vi.fn(() => Promise.resolve()),
  getSoundSnapshotMock: vi.fn(() => ({
    currentSessionEnabled: true,
  })),
  activeSessionStoreMock: {
    initialize: vi.fn(),
    initializePendingRequests: vi.fn(),
    mergeStatusRefresh: vi.fn(),
    mergePendingRequests: vi.fn(),
    setSessionMetaBulk: vi.fn(),
    setSessionMeta: vi.fn(),
    getSessionMeta: vi.fn((sessionId?: string) => ({ title: sessionId || 'Child Session', directory: '/workspace' })),
    addPendingRequest: vi.fn(),
    resolvePendingRequest: vi.fn(),
    updateStatus: vi.fn(),
    getSnapshot: vi.fn(() => ({ statusMap: {} })),
    getSessionIdsForScope: vi.fn(() => [] as string[]),
  },
  autoApproveStoreMock: {
    fullAutoMode: 'off' as 'off' | 'session' | 'global',
    approvePendingOnFullAuto: false,
    subscribe: vi.fn((_listener: () => void) => vi.fn()),
    claimAutoReply: vi.fn((_requestId: string) => true),
    releaseAutoReply: vi.fn((_requestId: string) => undefined),
  },
}))

vi.mock('../api', () => ({
  subscribeToEvents: subscribeToEventsMock,
  getSessionStatus: getSessionStatusMock,
  getPendingPermissions: getPendingPermissionsMock,
  getPendingQuestions: getPendingQuestionsMock,
}))

vi.mock('../api/permission', () => ({
  replyPermission: replyPermissionMock,
}))

vi.mock('../store', () => ({
  messageStore: {
    handleMessageUpdated: vi.fn(),
    handlePartUpdated: vi.fn(),
    handlePartDelta: vi.fn(),
    handlePartRemoved: vi.fn(),
    handleSessionIdle: vi.fn(),
    handleSessionError: vi.fn(),
    getSessionState: vi.fn(() => null),
    updateSessionMetadata: vi.fn(),
    removeMessage: messageRemoveMock,
    markAllSessionsStale: markAllSessionsStaleMock,
  },
  childSessionStore: {
    belongsToSession: childBelongsToSessionMock,
    getSessionAndDescendants: getSessionAndDescendantsMock,
    markIdle: vi.fn(),
    markError: vi.fn(),
    registerChildSession: vi.fn(),
  },
  paneLayoutStore: {
    getFocusedSessionId: getFocusedSessionIdMock,
    clearSession: clearPaneSessionMock,
  },
  serverStore: {
    applyServerConnectedTimestamp: applyServerConnectedTimestampMock,
    getActiveServerId: getActiveServerIdMock,
    checkHealth: checkHealthMock,
    onServerChange: onServerChangeMock,
  },
}))

vi.mock('../store/activeSessionStore', () => ({
  activeSessionStore: activeSessionStoreMock,
}))

vi.mock('../store/notificationStore', () => ({
  notificationStore: {
    push: notificationPushMock,
  },
}))

vi.mock('../api/file', () => ({
  invalidateRootDirectoryCache: invalidateRootDirectoryCacheMock,
}))

vi.mock('../store/runtimeInvalidationStore', () => ({
  runtimeInvalidationStore: {
    emit: runtimeInvalidationEmitMock,
  },
}))

vi.mock('./useNotification', () => ({
  useNotification: () => ({ sendNotification: sendNotificationMock }),
}))

vi.mock('../store/soundStore', () => ({
  soundStore: {
    getSnapshot: () => getSoundSnapshotMock(),
  },
}))

vi.mock('../store/notificationEventSettingsStore', () => ({
  notificationEventSettingsStore: {
    isSystemEnabled: (type: 'completed' | 'permission' | 'question' | 'error') => isSystemEnabledMock(type),
  },
}))

vi.mock('../utils/notificationSoundBridge', () => ({
  playNotificationSoundDeduped: playNotificationSoundDedupedMock,
}))

vi.mock('../utils/sessionLifecycle', () => ({
  clearSessionRuntimeState: (...args: unknown[]) => clearSessionRuntimeStateMock(...args),
}))

vi.mock('../store/autoApproveStore', () => ({
  autoApproveStore: autoApproveStoreMock,
}))

describe('useGlobalEvents', () => {
  beforeEach(() => {
    subscribeToEventsMock.mockReset()
    getSessionStatusMock.mockClear()
    getPendingPermissionsMock.mockClear()
    getPendingQuestionsMock.mockClear()
    replyPermissionMock.mockClear()
    childBelongsToSessionMock.mockReset()
    getFocusedSessionIdMock.mockReset()
    getSessionAndDescendantsMock.mockReset()
    notificationPushMock.mockReset()
    playNotificationSoundDedupedMock.mockReset()
    getSoundSnapshotMock.mockReset()
    isSystemEnabledMock.mockReset()
    applyServerConnectedTimestampMock.mockReset()
    getActiveServerIdMock.mockReset()
    checkHealthMock.mockReset()
    onServerChangeMock.mockReset()
    clearSessionRuntimeStateMock.mockReset()
    clearPaneSessionMock.mockReset()
    messageRemoveMock.mockReset()
    markAllSessionsStaleMock.mockReset()
    runtimeInvalidationEmitMock.mockReset()
    invalidateRootDirectoryCacheMock.mockReset()
    sendNotificationMock.mockReset()
    autoApproveStoreMock.fullAutoMode = 'off'
    autoApproveStoreMock.approvePendingOnFullAuto = false
    autoApproveStoreMock.subscribe.mockReset()
    autoApproveStoreMock.claimAutoReply.mockReset()
    autoApproveStoreMock.releaseAutoReply.mockReset()
    Object.values(activeSessionStoreMock).forEach(value => {
      if (typeof value === 'function' && 'mockClear' in value) value.mockClear()
    })

    subscribeToEventsMock.mockImplementation(() => vi.fn())
    getSoundSnapshotMock.mockReturnValue({
      currentSessionEnabled: true,
    })
    isSystemEnabledMock.mockImplementation((type: string) => type !== 'permission')
    getActiveServerIdMock.mockReturnValue('local')
    checkHealthMock.mockResolvedValue({ status: 'online' })
    onServerChangeMock.mockReturnValue(vi.fn())
    getSessionAndDescendantsMock.mockImplementation((sessionId: string) => [sessionId])
    autoApproveStoreMock.subscribe.mockReturnValue(vi.fn())
    autoApproveStoreMock.claimAutoReply.mockReturnValue(true)
    activeSessionStoreMock.getSessionMeta.mockReturnValue({ title: 'Child Session', directory: '/workspace' })
    activeSessionStoreMock.getSnapshot.mockReturnValue({ statusMap: {} })
    sendNotificationMock.mockResolvedValue(undefined)
    activeSessionStoreMock.getSessionIdsForScope.mockReturnValue([])
  })

  it('stores server clock calibration when server.connected arrives', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onServerConnected?.({ timestamp: '2026-04-22T15:00:00.000Z' }, GLOBAL_SCOPE)

    expect(applyServerConnectedTimestampMock).toHaveBeenCalledWith('local', '2026-04-22T15:00:00.000Z')
  })

  it('refreshes active server health on mount', async () => {
    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(checkHealthMock).toHaveBeenCalledWith('local'))
  })

  it('refreshes health for the selected server when active server changes', async () => {
    let onServerChange: ((serverId: string) => void) | undefined
    onServerChangeMock.mockImplementation(listener => {
      onServerChange = listener
      return vi.fn()
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(onServerChange).toBeDefined())
    checkHealthMock.mockClear()

    onServerChange!('remote')

    expect(checkHealthMock).toHaveBeenCalledWith('remote')
  })

  it('refreshes active server health when SSE reconnects', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())
    checkHealthMock.mockClear()

    callbacks!.onReconnected?.('network', 'local')

    expect(checkHealthMock).toHaveBeenCalledWith('local')
  })

  it('clears runtime state and panes when a session is deleted', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getSessionAndDescendantsMock.mockReturnValue(['deleted-session', 'child-session'])

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onSessionDeleted?.('deleted-session', TEST_SCOPE)

    expect(clearSessionRuntimeStateMock).toHaveBeenCalledWith('deleted-session', 'local')
    expect(clearPaneSessionMock).toHaveBeenCalledWith('deleted-session')
    expect(clearPaneSessionMock).toHaveBeenCalledWith('child-session')
  })

  it('ignores stale initialization responses after directories change', async () => {
    const statusDeferreds = new Map<string, ReturnType<typeof createDeferred<Record<string, { type: string }>>>>()
    getPendingPermissionsMock.mockResolvedValue([])
    getPendingQuestionsMock.mockResolvedValue([])
    getSessionStatusMock.mockImplementation(scope => {
      const key = scope?.directory || 'root'
      const deferred = createDeferred<Record<string, { type: string }>>()
      statusDeferreds.set(key, deferred)
      return deferred.promise
    })

    const { rerender } = renderHook(({ directories }) => useGlobalEvents(directories), {
      initialProps: { directories: ['/one'] as string[] | undefined },
    })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/one' }))

    rerender({ directories: ['/two'] })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/two' }))

    statusDeferreds.get('/two')?.resolve({ 'new-session': { type: 'busy' } })

    await waitFor(() => {
      expect(activeSessionStoreMock.mergeStatusRefresh).toHaveBeenCalledTimes(1)
      expect(activeSessionStoreMock.mergeStatusRefresh).toHaveBeenCalledWith({ 'new-session': { type: 'busy' } })
    })

    statusDeferreds.get('/one')?.resolve({ 'old-session': { type: 'idle' } })
    await Promise.resolve()
    await Promise.resolve()

    expect(activeSessionStoreMock.mergeStatusRefresh).toHaveBeenCalledTimes(1)
    expect(activeSessionStoreMock.mergeStatusRefresh).not.toHaveBeenCalledWith({ 'old-session': { type: 'idle' } })
  })

  it('ignores initialization responses from the server active before a switch', async () => {
    let onServerChange: ((serverId: string) => void) | undefined
    const statusDeferred = createDeferred<Record<string, { type: string }>>()
    onServerChangeMock.mockImplementation(listener => {
      onServerChange = listener
      return vi.fn()
    })
    getSessionStatusMock.mockImplementation(() => statusDeferred.promise)
    getPendingPermissionsMock.mockResolvedValue([])
    getPendingQuestionsMock.mockResolvedValue([])

    renderHook(() => useGlobalEvents(['/workspace']))
    await waitFor(() => {
      expect(onServerChange).toBeDefined()
      expect(getSessionStatusMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/workspace' })
    })

    getActiveServerIdMock.mockReturnValue('remote')
    onServerChange!('remote')
    statusDeferred.resolve({ 'old-session': { type: 'busy' } })
    await Promise.resolve()
    await Promise.resolve()

    expect(activeSessionStoreMock.initialize).not.toHaveBeenCalled()
    expect(activeSessionStoreMock.mergeStatusRefresh).not.toHaveBeenCalled()
  })

  it('replays pending requests that arrive while initialization is in flight', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    const statusDeferred = createDeferred<Record<string, { type: string }>>()

    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getSessionStatusMock.mockImplementation(() => statusDeferred.promise)
    getPendingPermissionsMock.mockResolvedValue([])
    getPendingQuestionsMock.mockResolvedValue([])

    renderHook(() => useGlobalEvents(['/workspace']))

    await waitFor(() =>
      expect(getSessionStatusMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/workspace' }),
    )
    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.(
      {
        id: 'perm-1',
        sessionID: 'child-session',
        permission: 'edit',
        patterns: ['src/app.tsx'],
      } as never,
      TEST_SCOPE,
    )

    statusDeferred.resolve({})

    await waitFor(() => expect(activeSessionStoreMock.initializePendingRequests).toHaveBeenCalled())

    expect(activeSessionStoreMock.addPendingRequest).toHaveBeenNthCalledWith(
      1,
      'perm-1',
      'child-session',
      'permission',
      'edit: src/app.tsx',
    )
    expect(activeSessionStoreMock.addPendingRequest).toHaveBeenNthCalledWith(
      2,
      'perm-1',
      'child-session',
      'permission',
      'edit: src/app.tsx',
    )
  })

  it('keeps replaying pending requests across overlapping initialization fetches', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    const statusDeferreds = new Map<string, ReturnType<typeof createDeferred<Record<string, { type: string }>>>>()

    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    activeSessionStoreMock.getSessionMeta.mockImplementation((sessionId?: string) => {
      if (sessionId === 'child-session') return { title: 'Child Session', directory: '/one' }
      if (sessionId === 'question-session') return { title: 'Question Session', directory: '/two' }
      return { title: 'Session', directory: '/workspace' }
    })
    getSessionStatusMock.mockImplementation(scope => {
      const key = scope?.directory || 'root'
      const deferred = createDeferred<Record<string, { type: string }>>()
      statusDeferreds.set(key, deferred)
      return deferred.promise
    })
    getPendingPermissionsMock.mockResolvedValue([])
    getPendingQuestionsMock.mockResolvedValue([])

    const { rerender } = renderHook(({ directories }) => useGlobalEvents(directories), {
      initialProps: { directories: ['/one'] as string[] | undefined },
    })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/one' }))
    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.(
      {
        id: 'perm-1',
        sessionID: 'child-session',
        permission: 'edit',
        patterns: ['src/app.tsx'],
      } as never,
      { serverID: 'local', directory: '/one' },
    )

    rerender({ directories: ['/two'] })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/two' }))

    callbacks!.onQuestionAsked?.(
      {
        id: 'question-1',
        sessionID: 'question-session',
        questions: [{ header: 'Need input' }],
      } as never,
      { serverID: 'local', directory: '/two' },
    )

    statusDeferreds.get('/two')?.resolve({})

    await waitFor(() => expect(activeSessionStoreMock.mergePendingRequests).toHaveBeenCalledTimes(1))

    expect(activeSessionStoreMock.addPendingRequest.mock.calls.filter(call => call[0] === 'perm-1')).toHaveLength(1)
    expect(activeSessionStoreMock.addPendingRequest.mock.calls.filter(call => call[0] === 'question-1')).toHaveLength(2)
  })

  it('does not play current-session sound for child session events when parent session is focused', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('parent-session')
    childBelongsToSessionMock.mockImplementation((sessionId: string, rootSessionId: string) => {
      return sessionId === 'child-session' && rootSessionId === 'parent-session'
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.(
      {
        id: 'perm-1',
        sessionID: 'child-session',
        permission: 'bash',
        patterns: [],
      },
      TEST_SCOPE,
    )

    expect(notificationPushMock).not.toHaveBeenCalled()
    expect(playNotificationSoundDedupedMock).not.toHaveBeenCalled()
  })

  it('keeps later pending question requests for the same session after one reply arrives', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    const consumerAskedMock = vi.fn()
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onQuestionAsked?.(
      {
        id: 'question-1',
        sessionID: 'child-session',
        questions: [{ header: 'First question' }],
      },
      TEST_SCOPE,
    )
    callbacks!.onQuestionAsked?.(
      {
        id: 'question-2',
        sessionID: 'child-session',
        questions: [{ header: 'Second question' }],
      },
      TEST_SCOPE,
    )

    expect(consumerAskedMock).not.toHaveBeenCalled()

    callbacks!.onQuestionReplied?.(
      {
        sessionID: 'child-session',
        requestID: 'question-1',
      },
      TEST_SCOPE,
    )

    getFocusedSessionIdMock.mockReturnValue('parent-session')
    childBelongsToSessionMock.mockImplementation((sessionId: string, rootSessionId: string) => {
      return sessionId === 'child-session' && rootSessionId === 'parent-session'
    })

    const unregister = registerSessionConsumer('pane-1', 'parent-session', {
      onQuestionAsked: consumerAskedMock,
    })

    callbacks!.onSessionCreated?.(
      {
        id: 'child-session',
        parentID: 'parent-session',
        title: 'Child Session',
        directory: '/workspace',
      } as never,
      TEST_SCOPE,
    )

    expect(consumerAskedMock).toHaveBeenCalledTimes(1)
    expect(consumerAskedMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'question-2', sessionID: 'child-session' }),
    )

    unregister()
  })

  it('approves already waiting permissions when global full auto pending sweep is enabled', async () => {
    const consumerRepliedMock = vi.fn()
    const unregister = registerSessionConsumer('pane-global', 'background-session', {
      onPermissionReplied: consumerRepliedMock,
    })
    autoApproveStoreMock.fullAutoMode = 'global'
    autoApproveStoreMock.approvePendingOnFullAuto = true
    getPendingPermissionsMock.mockResolvedValue([
      {
        id: 'perm-global',
        sessionID: 'background-session',
        permission: 'bash',
        patterns: ['npm test'],
      },
    ])
    activeSessionStoreMock.getSessionMeta.mockReturnValue({ title: 'Background', directory: '/workspace' })

    renderHook(() => useGlobalEvents(['/workspace']))

    await waitFor(() => {
      expect(replyPermissionMock).toHaveBeenCalledWith(
        'perm-global',
        'once',
        undefined,
        '/workspace',
        'background-session',
      )
    })
    expect(autoApproveStoreMock.claimAutoReply).toHaveBeenCalledWith('perm-global')
    await waitFor(() => {
      expect(consumerRepliedMock).toHaveBeenCalledWith({ sessionID: 'background-session', requestID: 'perm-global' })
    })
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-global')

    unregister()
  })

  it('broadcasts permission replied events to consumers even when the current session does not match', async () => {
    const consumerRepliedMock = vi.fn()
    const unregister = registerSessionConsumer('pane-mismatch', 'other-session', {
      onPermissionReplied: consumerRepliedMock,
    })
    autoApproveStoreMock.fullAutoMode = 'global'
    autoApproveStoreMock.approvePendingOnFullAuto = true
    getPendingPermissionsMock.mockResolvedValue([
      {
        id: 'perm-mismatch',
        sessionID: 'background-session',
        permission: 'bash',
        patterns: ['npm test'],
      },
    ])
    activeSessionStoreMock.getSessionMeta.mockReturnValue({ title: 'Background', directory: '/workspace' })

    renderHook(() => useGlobalEvents(['/workspace']))

    await waitFor(() => {
      expect(replyPermissionMock).toHaveBeenCalledWith(
        'perm-mismatch',
        'once',
        undefined,
        '/workspace',
        'background-session',
      )
    })
    await waitFor(() => {
      expect(consumerRepliedMock).toHaveBeenCalledWith({ sessionID: 'background-session', requestID: 'perm-mismatch' })
    })

    unregister()
  })

  it('does not approve already waiting permissions when the pending sweep is disabled', async () => {
    autoApproveStoreMock.fullAutoMode = 'global'
    autoApproveStoreMock.approvePendingOnFullAuto = false
    getPendingPermissionsMock.mockResolvedValue([
      {
        id: 'perm-global',
        sessionID: 'background-session',
        permission: 'bash',
        patterns: ['npm test'],
      },
    ])

    renderHook(() => useGlobalEvents(['/workspace']))

    await waitFor(() => expect(getPendingPermissionsMock).toHaveBeenCalled())
    expect(replyPermissionMock).not.toHaveBeenCalled()
  })

  it('still plays current-session sound for the directly focused session', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('child-session')

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.(
      {
        id: 'perm-2',
        sessionID: 'child-session',
        permission: 'bash',
        patterns: [],
      },
      TEST_SCOPE,
    )

    expect(notificationPushMock).not.toHaveBeenCalled()
    expect(playNotificationSoundDedupedMock).toHaveBeenCalledWith('permission')
  })

  it('still plays current-session sound when the matching system notification toggle is disabled', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('child-session')
    isSystemEnabledMock.mockImplementation(type => type !== 'permission')

    renderHook(() => useGlobalEvents())

    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.(
      {
        id: 'perm-sound',
        sessionID: 'child-session',
        permission: 'bash',
        patterns: [],
      },
      TEST_SCOPE,
    )

    expect(notificationPushMock).not.toHaveBeenCalled()
    expect(playNotificationSoundDedupedMock).toHaveBeenCalledWith('permission')
  })

  it('ignores stale-server events and removes messages for the active scoped stream', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents(['/workspace']))
    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onMessageRemoved?.(
      { sessionID: 'session-1', messageID: 'stale-message' },
      { serverID: 'remote', directory: '/workspace' },
    )
    expect(messageRemoveMock).not.toHaveBeenCalled()

    callbacks!.onMessageRemoved?.({ sessionID: 'session-1', messageID: 'message-1' }, TEST_SCOPE)
    expect(messageRemoveMock).toHaveBeenCalledWith('session-1', 'message-1')
  })

  it('invalidates scoped file and LSP consumers', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents(['/workspace']))
    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onFileWatcherUpdated?.({ file: '/workspace/src/app.ts', event: 'change' }, TEST_SCOPE)
    callbacks!.onLspUpdated?.({}, TEST_SCOPE)

    expect(invalidateRootDirectoryCacheMock).toHaveBeenCalledWith({
      serverID: 'local',
      directory: '/workspace',
    })
    expect(runtimeInvalidationEmitMock).toHaveBeenCalledWith({
      type: 'file',
      scope: TEST_SCOPE,
      file: '/workspace/src/app.ts',
      event: 'change',
    })
    expect(runtimeInvalidationEmitMock).toHaveBeenCalledWith({ type: 'lsp', scope: TEST_SCOPE })
  })

  it('invalidates directory and workspace root cache keys independently', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents(['/workspace']))
    await waitFor(() => expect(callbacks).toBeDefined())
    invalidateRootDirectoryCacheMock.mockClear()

    callbacks!.onFileWatcherUpdated?.(
      { file: '/workspace/src/app.ts', event: 'change' },
      { serverID: 'local', directory: '/workspace', workspace: 'workspace-a' },
    )

    expect(invalidateRootDirectoryCacheMock).toHaveBeenNthCalledWith(1, {
      serverID: 'local',
      directory: '/workspace',
    })
    expect(invalidateRootDirectoryCacheMock).toHaveBeenNthCalledWith(2, {
      serverID: 'local',
      workspace: 'workspace-a',
    })
  })

  it('uses one resync path for event gaps and reconnects', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    const onReconnected = vi.fn()
    const unregister = registerSessionConsumer('pane-resync', 'session-1', { onReconnected })
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents(['/one', '/two']))
    await waitFor(() => expect(callbacks).toBeDefined())
    markAllSessionsStaleMock.mockClear()
    invalidateRootDirectoryCacheMock.mockClear()
    runtimeInvalidationEmitMock.mockClear()
    checkHealthMock.mockClear()

    callbacks!.onEventGap?.({ dropped: 2 }, GLOBAL_SCOPE)

    expect(markAllSessionsStaleMock).toHaveBeenCalledTimes(1)
    expect(invalidateRootDirectoryCacheMock).toHaveBeenCalledWith({
      serverID: 'local',
      directory: '/one',
    })
    expect(invalidateRootDirectoryCacheMock).toHaveBeenCalledWith({
      serverID: 'local',
      directory: '/two',
    })
    expect(runtimeInvalidationEmitMock).toHaveBeenCalledWith({
      type: 'file',
      scope: GLOBAL_SCOPE,
      event: 'resync',
    })
    expect(onReconnected).toHaveBeenCalledWith('event-gap', 'local')

    onReconnected.mockClear()
    callbacks!.onReconnected?.('network', 'local')
    expect(onReconnected).toHaveBeenCalledWith('network', 'local')

    unregister()
  })

  it('clears instance and global runtime scopes before resyncing', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    activeSessionStoreMock.getSessionIdsForScope.mockReturnValue(['session-1', 'session-2'])

    renderHook(() => useGlobalEvents(['/workspace']))
    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onServerInstanceDisposed?.({ directory: '/workspace' }, TEST_SCOPE)

    expect(activeSessionStoreMock.getSessionIdsForScope).toHaveBeenCalledWith({
      serverID: 'local',
      directory: '/workspace',
      workspace: undefined,
    })
    expect(clearSessionRuntimeStateMock).toHaveBeenCalledWith('session-1', 'local')
    expect(clearSessionRuntimeStateMock).toHaveBeenCalledWith('session-2', 'local')
    expect(clearPaneSessionMock).toHaveBeenCalledWith('session-1')
    expect(clearPaneSessionMock).toHaveBeenCalledWith('session-2')
    expect(runtimeInvalidationEmitMock).toHaveBeenCalledWith({
      type: 'file',
      scope: TEST_SCOPE,
      event: 'disposed',
    })

    activeSessionStoreMock.getSessionIdsForScope.mockClear()
    callbacks!.onGlobalDisposed?.({}, GLOBAL_SCOPE)
    expect(activeSessionStoreMock.getSessionIdsForScope).toHaveBeenCalledWith({
      serverID: 'local',
      directory: undefined,
      workspace: undefined,
    })
  })

  it('sends one system notification for multiple matching pane consumers', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    const firstConsumer = vi.fn()
    const secondConsumer = vi.fn()
    const unregisterFirst = registerSessionConsumer('pane-a', 'session-1', { onPermissionAsked: firstConsumer })
    const unregisterSecond = registerSessionConsumer('pane-b', 'session-1', { onPermissionAsked: secondConsumer })
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })
    getFocusedSessionIdMock.mockReturnValue('session-1')
    isSystemEnabledMock.mockReturnValue(true)

    renderHook(() => useGlobalEvents(['/workspace']))
    await waitFor(() => expect(callbacks).toBeDefined())

    callbacks!.onPermissionAsked?.(
      { id: 'permission-1', sessionID: 'session-1', permission: 'bash', patterns: ['npm test'] },
      TEST_SCOPE,
    )

    expect(firstConsumer).toHaveBeenCalledTimes(1)
    expect(secondConsumer).toHaveBeenCalledTimes(1)
    expect(sendNotificationMock).toHaveBeenCalledTimes(1)

    unregisterFirst()
    unregisterSecond()
  })

  it.each([
    {
      disabledType: 'permission',
      trigger: 'onPermissionAsked',
      payload: { id: 'perm-3', sessionID: 'background-session', permission: 'bash', patterns: [] },
    },
    {
      disabledType: 'question',
      trigger: 'onQuestionAsked',
      payload: {
        id: 'question-3',
        sessionID: 'background-session',
        questions: [{ header: 'Need input' }],
      },
    },
    {
      disabledType: 'completed',
      trigger: 'onSessionStatus',
      beforeTrigger: () => {
        activeSessionStoreMock.getSnapshot.mockReturnValue({ statusMap: { 'background-session': { type: 'busy' } } })
      },
      payload: { sessionID: 'background-session', status: { type: 'idle' } },
    },
    {
      disabledType: 'error',
      trigger: 'onSessionError',
      payload: { sessionID: 'background-session', name: 'Error' },
    },
  ])(
    'keeps background notifications working when the $disabledType system notification toggle is disabled',
    async ({ disabledType, trigger, payload, beforeTrigger }) => {
      let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
      subscribeToEventsMock.mockImplementation(cb => {
        callbacks = cb
        return vi.fn()
      })
      isSystemEnabledMock.mockImplementation(type => type !== disabledType)
      beforeTrigger?.()

      renderHook(() => useGlobalEvents())

      await waitFor(() => expect(callbacks).toBeDefined())

      const callback = callbacks![trigger as keyof typeof callbacks] as
        | ((value: never, scope: typeof TEST_SCOPE) => void)
        | undefined
      callback?.(payload as never, TEST_SCOPE)

      expect(notificationPushMock).toHaveBeenCalledTimes(1)
      expect(playNotificationSoundDedupedMock).not.toHaveBeenCalled()
    },
  )

  it('excludes LRU-disposed directories from automatic refetch until re-pinned', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    const { rerender } = renderHook(({ pinned }) => useGlobalEvents(['/one', '/two'], { pinnedDirectories: pinned }), {
      initialProps: { pinned: ['/one'] },
    })
    await waitFor(() => expect(callbacks).toBeDefined())
    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalled())
    getSessionStatusMock.mockClear()

    callbacks!.onServerInstanceDisposed?.({ directory: '/two', reason: 'post-load-lru' } as never, {
      serverID: 'local',
      directory: '/two',
    })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalled(), { timeout: 2000 })
    const directories = getSessionStatusMock.mock.calls.map(call => call[0]?.directory)
    expect(directories).toContain('/one')
    expect(directories).not.toContain('/two')

    // 用户切回该目录（进入 pinned）后解除休眠，自动刷新恢复覆盖
    getSessionStatusMock.mockClear()
    rerender({ pinned: ['/one', '/two'] })
    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalled())
    const revived = getSessionStatusMock.mock.calls.map(call => call[0]?.directory)
    expect(revived).toContain('/two')
  })

  it('does not mark directories dormant for non-LRU dispose reasons', async () => {
    let callbacks: Parameters<typeof subscribeToEventsMock>[0] | undefined
    subscribeToEventsMock.mockImplementation(cb => {
      callbacks = cb
      return vi.fn()
    })

    renderHook(() => useGlobalEvents(['/reload-me']))
    await waitFor(() => expect(callbacks).toBeDefined())
    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalled())
    getSessionStatusMock.mockClear()

    callbacks!.onServerInstanceDisposed?.({ directory: '/reload-me', reason: 'reload' } as never, {
      serverID: 'local',
      directory: '/reload-me',
    })

    await waitFor(() => expect(getSessionStatusMock).toHaveBeenCalled(), { timeout: 2000 })
    const directories = getSessionStatusMock.mock.calls.map(call => call[0]?.directory)
    expect(directories).toContain('/reload-me')
  })
})

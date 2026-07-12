import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateAllRootDirectoryCaches: vi.fn(),
  resetActiveSessions: vi.fn(),
  activatePaneServer: vi.fn(),
  activateFollowupServer: vi.fn(),
  syncTerminalSessions: vi.fn(),
  activateNotificationServer: vi.fn(),
  emitRuntimeInvalidation: vi.fn(),
}))

vi.mock('../api/file', () => ({
  invalidateAllRootDirectoryCaches: mocks.invalidateAllRootDirectoryCaches,
}))

vi.mock('../store/activeSessionStore', () => ({
  activeSessionStore: { resetRuntimeState: mocks.resetActiveSessions },
}))

vi.mock('../store/paneLayoutStore', () => ({
  paneLayoutStore: { activateServer: mocks.activatePaneServer },
}))

vi.mock('../store/followupQueueStore', () => ({
  followupQueueStore: { activateServer: mocks.activateFollowupServer },
}))

vi.mock('../store/layoutStore', () => ({
  layoutStore: { syncTerminalSessions: mocks.syncTerminalSessions },
}))

vi.mock('../store/notificationStore', () => ({
  notificationStore: { activateServer: mocks.activateNotificationServer },
}))

vi.mock('../store/runtimeInvalidationStore', () => ({
  runtimeInvalidationStore: { emit: mocks.emitRuntimeInvalidation },
}))

import { resetServerScopedRuntime } from './serverTransition'

describe('resetServerScopedRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cleans every server-scoped runtime store exactly once for the new server', () => {
    resetServerScopedRuntime('server-next')

    expect(mocks.resetActiveSessions).toHaveBeenCalledTimes(1)
    expect(mocks.activatePaneServer).toHaveBeenCalledWith('server-next')
    expect(mocks.activateFollowupServer).toHaveBeenCalledWith('server-next')
    expect(mocks.syncTerminalSessions).toHaveBeenCalledTimes(1)
    expect(mocks.syncTerminalSessions).toHaveBeenCalledWith(undefined, [])
    expect(mocks.activateNotificationServer).toHaveBeenCalledTimes(1)
    expect(mocks.activateNotificationServer).toHaveBeenCalledWith('server-next')
    expect(mocks.activateNotificationServer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activatePaneServer.mock.invocationCallOrder[0],
    )
    expect(mocks.activateNotificationServer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activateFollowupServer.mock.invocationCallOrder[0],
    )
    expect(mocks.invalidateAllRootDirectoryCaches).toHaveBeenCalledTimes(1)
    expect(mocks.emitRuntimeInvalidation).toHaveBeenNthCalledWith(1, {
      type: 'file',
      scope: { serverID: 'server-next', directory: 'global' },
      event: 'resync',
    })
    expect(mocks.emitRuntimeInvalidation).toHaveBeenNthCalledWith(2, {
      type: 'lsp',
      scope: { serverID: 'server-next', directory: 'global' },
    })
  })
})

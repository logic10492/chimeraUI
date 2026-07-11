import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getActiveServerIdMock,
  getSessionMetaMock,
  getSessionMetaServerIDsMock,
  setSessionMetaBulkMock,
  setSessionMetaMock,
} = vi.hoisted(() => ({
  getActiveServerIdMock: vi.fn(() => 'server-active'),
  getSessionMetaMock: vi.fn(),
  getSessionMetaServerIDsMock: vi.fn(() => [] as string[]),
  setSessionMetaBulkMock: vi.fn(),
  setSessionMetaMock: vi.fn(),
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: getActiveServerIdMock,
  },
}))

vi.mock('../store/activeSessionStore', () => ({
  activeSessionStore: {
    getSessionMeta: getSessionMetaMock,
    getSessionMetaServerIDs: getSessionMetaServerIDsMock,
    setSessionMeta: setSessionMetaMock,
    setSessionMetaBulk: setSessionMetaBulkMock,
  },
}))

import {
  activeApiScope,
  apiScopeKey,
  apiScopeQuery,
  rememberSessionApiScope,
  resolveApiScope,
  resolveSessionApiScope,
} from './scope'

describe('ApiScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveServerIdMock.mockReturnValue('server-active')
    getSessionMetaMock.mockReturnValue(undefined)
    getSessionMetaServerIDsMock.mockReturnValue([])
  })

  it('binds active directory scope to the current server', () => {
    expect(activeApiScope('/workspace/demo/')).toEqual({
      serverID: 'server-active',
      directory: '/workspace/demo',
    })
  })

  it('prefers workspace routing over directory routing', () => {
    const scope = resolveApiScope({ serverID: 'server-a', directory: '/same', workspace: 'workspace-a' })

    expect(scope).toEqual({ serverID: 'server-a', workspace: 'workspace-a' })
    expect(apiScopeQuery(scope)).toEqual({ workspace: 'workspace-a' })
  })

  it('uses server and workspace identity in scope keys', () => {
    expect(apiScopeKey({ serverID: 'server-a', directory: '/same' })).not.toBe(
      apiScopeKey({ serverID: 'server-b', directory: '/same' }),
    )
    expect(apiScopeKey({ serverID: 'server-a', workspace: 'workspace-a' })).not.toBe(
      apiScopeKey({ serverID: 'server-a', directory: 'workspace-a' }),
    )
  })

  it('resolves target session workspace and server before caller directory', () => {
    getSessionMetaMock.mockReturnValue({
      directory: '/target',
      serverID: 'server-a',
      workspaceID: 'workspace-a',
    })

    expect(resolveSessionApiScope('session-1', '/current-page')).toEqual({
      serverID: 'server-a',
      workspace: 'workspace-a',
    })
    expect(getSessionMetaMock).toHaveBeenCalledWith('session-1', undefined)
  })

  it('rejects ambiguous target sessions without an explicit server scope', () => {
    getSessionMetaServerIDsMock.mockReturnValue(['server-a', 'server-b'])

    expect(() => resolveSessionApiScope('shared', '/current-page')).toThrow(
      'Session shared exists on multiple servers; pass an explicit ApiScope',
    )
    expect(getSessionMetaMock).not.toHaveBeenCalled()
  })

  it('does not apply metadata from a different server to an explicit scope', () => {
    getSessionMetaMock.mockImplementation((_sessionId: string, serverID?: string) =>
      serverID === 'server-a'
        ? {
            directory: '/server-a',
            serverID: 'server-a',
            workspaceID: 'workspace-a',
          }
        : undefined,
    )

    expect(resolveSessionApiScope('session-1', { serverID: 'server-b', directory: '/server-b' })).toEqual({
      serverID: 'server-b',
      directory: '/server-b',
    })
    expect(getSessionMetaMock).toHaveBeenCalledWith('session-1', 'server-b')
  })

  it('records server and workspace metadata returned by the session contract', () => {
    rememberSessionApiScope(
      {
        id: 'session-1',
        title: 'Scoped session',
        directory: '/workspace/demo',
        workspaceID: 'workspace-a',
      } as never,
      { serverID: 'server-a', directory: '/fallback' },
    )

    expect(setSessionMetaMock).toHaveBeenCalledWith(
      'session-1',
      'Scoped session',
      '/workspace/demo',
      'server-a',
      'workspace-a',
    )
  })
})

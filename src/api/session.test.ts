import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  activeApiScopeMock,
  apiScopeQueryMock,
  getSDKClientMock,
  listMock,
  rememberSessionApiScopeMock,
  rememberSessionApiScopesMock,
  resolveApiScopeMock,
  resolveSessionApiScopeMock,
  updateMock,
} = vi.hoisted(() => ({
  activeApiScopeMock: vi.fn(),
  apiScopeQueryMock: vi.fn((scope: { directory?: string; workspace?: string }) =>
    scope.workspace ? { workspace: scope.workspace } : { directory: scope.directory },
  ),
  getSDKClientMock: vi.fn(),
  listMock: vi.fn(),
  rememberSessionApiScopeMock: vi.fn(),
  rememberSessionApiScopesMock: vi.fn(),
  resolveApiScopeMock: vi.fn((scope: unknown) => scope),
  resolveSessionApiScopeMock: vi.fn(),
  updateMock: vi.fn(),
}))

vi.mock('./sdk', () => ({
  getSDKClient: getSDKClientMock,
  unwrap: <T>(result: { data?: T; error?: unknown }) => {
    if (result.error) throw result.error
    return result.data as T
  },
}))

vi.mock('./scope', () => ({
  activeApiScope: activeApiScopeMock,
  apiScopeQuery: apiScopeQueryMock,
  rememberSessionApiScope: rememberSessionApiScopeMock,
  rememberSessionApiScopes: rememberSessionApiScopesMock,
  resolveApiScope: resolveApiScopeMock,
  resolveSessionApiScope: resolveSessionApiScopeMock,
}))

import { getSessions, updateSession } from './session'

describe('session ApiScope routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSDKClientMock.mockReturnValue({ session: { list: listMock, update: updateMock } })
  })

  it('routes remote workspace lists with workspace ID instead of directory', async () => {
    const scope = { serverID: 'server-a', workspace: 'workspace-a' }
    const sessions = [{ id: 'session-1', title: 'Session', directory: '/remote', workspaceID: 'workspace-a' }]
    activeApiScopeMock.mockReturnValue(scope)
    listMock.mockResolvedValue({ data: sessions })

    await expect(getSessions({ workspace: 'workspace-a', roots: true })).resolves.toBe(sessions)

    expect(activeApiScopeMock).toHaveBeenCalledWith(undefined, 'workspace-a')
    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(listMock).toHaveBeenCalledWith({ workspace: 'workspace-a', roots: true })
    expect(rememberSessionApiScopesMock).toHaveBeenCalledWith(sessions, scope)
  })

  it('passes archived selection through the generated session list contract', async () => {
    const scope = { serverID: 'server-a', directory: '/remote' }
    activeApiScopeMock.mockReturnValue(scope)
    listMock.mockResolvedValue({ data: [] })

    await getSessions({ directory: '/remote', roots: true, archived: true })

    expect(listMock).toHaveBeenCalledWith({ directory: '/remote', roots: true, archived: true })
  })

  it('sends null explicitly when restoring a session', async () => {
    const scope = { serverID: 'server-a', directory: '/remote' }
    const session = { id: 'session-1', title: 'Restored', directory: '/remote' }
    resolveSessionApiScopeMock.mockReturnValue(scope)
    updateMock.mockResolvedValue({ data: session })

    await updateSession('session-1', { time: { archived: null } }, '/remote')

    expect(updateMock).toHaveBeenCalledWith({
      sessionID: 'session-1',
      directory: '/remote',
      time: { archived: null },
    })
  })

  it('uses target session metadata for mutations instead of the caller directory', async () => {
    const scope = { serverID: 'server-a', workspace: 'workspace-a' }
    const session = { id: 'session-1', title: 'Renamed', directory: '/remote', workspaceID: 'workspace-a' }
    resolveSessionApiScopeMock.mockReturnValue(scope)
    updateMock.mockResolvedValue({ data: session })

    await expect(updateSession('session-1', { title: 'Renamed' }, '/current-page')).resolves.toBe(session)

    expect(resolveSessionApiScopeMock).toHaveBeenCalledWith('session-1', '/current-page')
    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(updateMock).toHaveBeenCalledWith({
      sessionID: 'session-1',
      workspace: 'workspace-a',
      title: 'Renamed',
    })
    expect(rememberSessionApiScopeMock).toHaveBeenCalledWith(session, scope)
  })
})

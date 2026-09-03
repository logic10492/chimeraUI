import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveServerIdMock, getSDKClientMock, mcpMock, resourceMock } = vi.hoisted(() => ({
  getActiveServerIdMock: vi.fn(() => 'local'),
  getSDKClientMock: vi.fn(),
  mcpMock: {
    status: vi.fn(),
    add: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    auth: { start: vi.fn(), remove: vi.fn(), callback: vi.fn(), authenticate: vi.fn() },
  },
  resourceMock: {
    list: vi.fn(),
  },
}))

vi.mock('./sdk', () => ({
  getSDKClient: getSDKClientMock,
  unwrap: <T>(result: { data?: T; error?: unknown }) => {
    if (result.error) throw result.error
    return result.data as T
  },
}))

vi.mock('../store/serverStore', () => ({
  serverStore: { getActiveServerId: getActiveServerIdMock },
}))

import { addMcpServer, completeMcpAuth, getMcpResources, getMcpStatus, startMcpAuth } from './mcp'

describe('MCP API scope wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSDKClientMock.mockReturnValue({ mcp: mcpMock, experimental: { resource: resourceMock } })
    mcpMock.status.mockResolvedValue({ data: {} })
    mcpMock.add.mockResolvedValue({ data: undefined })
    mcpMock.auth.start.mockResolvedValue({ data: { authorizationUrl: 'https://auth.test' } })
    mcpMock.auth.callback.mockResolvedValue({ data: undefined })
    resourceMock.list.mockResolvedValue({ data: {} })
  })

  it('uses workspace queries and the matching scoped SDK client', async () => {
    const scope = { serverID: 'remote', workspace: 'workspace-a' }
    const config = { type: 'local' as const, command: ['mcp-server'] }

    await getMcpStatus(scope)
    await addMcpServer('docs', config, scope)
    await expect(startMcpAuth('docs', scope)).resolves.toEqual({ url: 'https://auth.test' })
    await completeMcpAuth('docs', 'code-1', scope)

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(mcpMock.status).toHaveBeenCalledWith({ workspace: 'workspace-a' })
    expect(mcpMock.add).toHaveBeenCalledWith({ name: 'docs', config, workspace: 'workspace-a' })
    expect(mcpMock.auth.start).toHaveBeenCalledWith({ name: 'docs', workspace: 'workspace-a' })
    expect(mcpMock.auth.callback).toHaveBeenCalledWith({ name: 'docs', code: 'code-1', workspace: 'workspace-a' })
  })

  it('preserves the legacy directory call shape', async () => {
    await getMcpStatus('/legacy')

    expect(getSDKClientMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/legacy' })
    expect(mcpMock.status).toHaveBeenCalledWith({ directory: '/legacy' })
  })

  it('lists MCP resources with the scoped SDK client and query', async () => {
    await getMcpResources('/project')

    expect(getSDKClientMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/project' })
    expect(resourceMock.list).toHaveBeenCalledWith({ directory: '/project' })
  })
})
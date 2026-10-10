import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveServerIdMock, getSDKClientMock, processMock } = vi.hoisted(() => ({
  getActiveServerIdMock: vi.fn(() => 'local'),
  getSDKClientMock: vi.fn(),
  processMock: {
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
  makeBasicAuthHeader: vi.fn(),
  serverStore: {
    getActiveServerId: getActiveServerIdMock,
    getServerAuth: vi.fn(() => null),
    getServerBaseUrl: vi.fn(() => 'http://localhost:4096'),
  },
}))

import { listProcesses } from './process'

const runningProcess = {
  id: 'process-1',
  sessionID: 'session-1',
  hostBootID: 'boot-1',
  pid: 4242,
  pgid: 4200,
  command: 'bun test --timeout 30000',
  cwd: '/repo',
  status: 'running' as const,
  exitCode: null,
  startedAt: '2026-10-09T04:00:00.000Z',
  exitedAt: null,
  sessionTitle: 'Run tests',
  agent: 'build',
}

describe('Process SDK wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveServerIdMock.mockReturnValue('local')
    getSDKClientMock.mockReturnValue({ process: processMock })
    processMock.list.mockResolvedValue({ data: [runningProcess] })
  })

  it('routes the instance directory scope into the process list query', async () => {
    await expect(listProcesses('/instance-workspace')).resolves.toEqual([runningProcess])

    expect(getSDKClientMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/instance-workspace' })
    expect(processMock.list).toHaveBeenCalledWith({ directory: '/instance-workspace' })
  })

  it('routes remote workspace operations by workspace ID', async () => {
    const scope = { serverID: 'remote', directory: '/same', workspace: 'workspace-a' }

    await expect(listProcesses(scope)).resolves.toEqual([runningProcess])

    expect(processMock.list).toHaveBeenCalledWith({ workspace: 'workspace-a' })
  })

  it('surfaces list errors instead of returning a partial registry', async () => {
    processMock.list.mockResolvedValue({ error: new Error('process registry unavailable') })

    await expect(listProcesses('/workspace')).rejects.toThrow('process registry unavailable')
  })
})

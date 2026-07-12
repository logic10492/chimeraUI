import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveServerIdMock, getSDKClientMock, fileListMock, findFilesMock } = vi.hoisted(() => ({
  getActiveServerIdMock: vi.fn(() => 'local'),
  getSDKClientMock: vi.fn(),
  fileListMock: vi.fn(),
  findFilesMock: vi.fn(),
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

import { invalidateAllRootDirectoryCaches, invalidateRootDirectoryCache, listDirectory, searchFiles } from './file'

describe('file API scope wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveServerIdMock.mockReturnValue('local')
    getSDKClientMock.mockImplementation(scope => ({
      file: {
        list: fileListMock.mockResolvedValue({
          data: [{ name: scope.serverID, path: scope.serverID, type: 'file' }],
        }),
      },
      find: { files: findFilesMock.mockResolvedValue({ data: [] }) },
    }))
  })

  it('isolates root directory caches by server and workspace scope', async () => {
    const local = { serverID: 'local', directory: '/same' }
    const remote = { serverID: 'remote', directory: '/same' }
    const workspace = { serverID: 'remote', workspace: 'workspace-a' }

    await expect(listDirectory('.', local)).resolves.toEqual([{ name: 'local', path: 'local', type: 'file' }])
    await expect(listDirectory('.', remote)).resolves.toEqual([{ name: 'remote', path: 'remote', type: 'file' }])
    await listDirectory('.', workspace)
    await listDirectory('.', local)

    expect(fileListMock).toHaveBeenCalledTimes(3)
    expect(fileListMock).toHaveBeenCalledWith({ path: '.', directory: '/same' })
    expect(fileListMock).toHaveBeenCalledWith({ path: '.', workspace: 'workspace-a' })
  })

  it('refetches only the invalidated root directory scope', async () => {
    const scope = { serverID: 'phase-3-refetch', directory: '/repo' }

    await listDirectory('.', scope)
    await listDirectory('.', scope)
    invalidateRootDirectoryCache(scope)
    await listDirectory('.', scope)

    expect(fileListMock).toHaveBeenCalledTimes(2)
    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
  })

  it('invalidates all server and workspace root caches during a server transition', async () => {
    const first = { serverID: 'phase-3-all-a', directory: '/repo' }
    const second = { serverID: 'phase-3-all-b', workspace: 'workspace-a' }

    await Promise.all([listDirectory('.', first), listDirectory('.', second)])
    await Promise.all([listDirectory('.', first), listDirectory('.', second)])
    invalidateAllRootDirectoryCaches()
    await Promise.all([listDirectory('.', first), listDirectory('.', second)])

    expect(fileListMock).toHaveBeenCalledTimes(4)
  })

  it('does not repopulate any root cache invalidated during an in-flight server transition', async () => {
    const scope = { serverID: 'phase-3-all-inflight', directory: '/repo' }
    let resolveFirst: (result: { data: Array<{ name: string; path: string; type: 'file' }> }) => void
    fileListMock
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce({ data: [{ name: 'fresh', path: 'fresh', type: 'file' }] })

    const staleRequest = listDirectory('.', scope)
    invalidateAllRootDirectoryCaches()
    resolveFirst!({ data: [{ name: 'stale', path: 'stale', type: 'file' }] })

    await expect(staleRequest).resolves.toEqual([{ name: 'stale', path: 'stale', type: 'file' }])
    await expect(listDirectory('.', scope)).resolves.toEqual([{ name: 'fresh', path: 'fresh', type: 'file' }])
    await listDirectory('.', scope)

    expect(fileListMock).toHaveBeenCalledTimes(2)
  })

  it('does not repopulate a root cache invalidated during an in-flight request', async () => {
    const scope = { serverID: 'phase-3-inflight', directory: '/repo' }
    let resolveFirst: (result: { data: Array<{ name: string; path: string; type: 'file' }> }) => void
    fileListMock
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce({ data: [{ name: 'fresh', path: 'fresh', type: 'file' }] })

    const staleRequest = listDirectory('.', scope)
    invalidateRootDirectoryCache(scope)
    resolveFirst!({ data: [{ name: 'stale', path: 'stale', type: 'file' }] })

    await expect(staleRequest).resolves.toEqual([{ name: 'stale', path: 'stale', type: 'file' }])
    await expect(listDirectory('.', scope)).resolves.toEqual([{ name: 'fresh', path: 'fresh', type: 'file' }])
    await listDirectory('.', scope)

    expect(fileListMock).toHaveBeenCalledTimes(2)
  })

  it('keeps other server, directory, and workspace root caches intact', async () => {
    const invalidated = { serverID: 'phase-3-isolated', directory: '/repo-a' }
    const otherDirectory = { serverID: 'phase-3-isolated', directory: '/repo-b' }
    const otherServer = { serverID: 'phase-3-other-server', directory: '/repo-a' }
    const otherWorkspace = { serverID: 'phase-3-isolated', workspace: 'workspace-a' }

    await Promise.all([
      listDirectory('.', invalidated),
      listDirectory('.', otherDirectory),
      listDirectory('.', otherServer),
      listDirectory('.', otherWorkspace),
    ])
    invalidateRootDirectoryCache(invalidated)
    await Promise.all([
      listDirectory('.', invalidated),
      listDirectory('.', otherDirectory),
      listDirectory('.', otherServer),
      listDirectory('.', otherWorkspace),
    ])

    expect(fileListMock).toHaveBeenCalledTimes(5)
    expect(fileListMock).toHaveBeenCalledWith({ path: '.', directory: '/repo-b' })
    expect(fileListMock).toHaveBeenCalledWith({ path: '.', workspace: 'workspace-a' })
  })

  it('preserves legacy directory options while accepting an explicit scope', async () => {
    await searchFiles('src', { directory: '/legacy' })
    await searchFiles('src', {
      scope: { serverID: 'remote', workspace: 'workspace-a' },
    })

    expect(getSDKClientMock).toHaveBeenNthCalledWith(1, { serverID: 'local', directory: '/legacy' })
    expect(getSDKClientMock).toHaveBeenNthCalledWith(2, {
      serverID: 'remote',
      workspace: 'workspace-a',
    })
    expect(findFilesMock).toHaveBeenNthCalledWith(1, {
      query: 'src',
      directory: '/legacy',
      type: undefined,
      limit: undefined,
    })
    expect(findFilesMock).toHaveBeenNthCalledWith(2, {
      query: 'src',
      workspace: 'workspace-a',
      type: undefined,
      limit: undefined,
    })
  })
})

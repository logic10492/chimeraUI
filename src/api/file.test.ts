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

import { listDirectory, searchFiles } from './file'

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

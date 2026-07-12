import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveServerIdMock, getSDKClientMock, vcsMock } = vi.hoisted(() => ({
  getActiveServerIdMock: vi.fn(() => 'local'),
  getSDKClientMock: vi.fn(),
  vcsMock: { get: vi.fn(), diff: vi.fn() },
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

import { getVcsDiff, getVcsInfo } from './vcs'

describe('VCS API scope wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSDKClientMock.mockReturnValue({ vcs: vcsMock })
    vcsMock.get.mockResolvedValue({ data: { branch: 'main' } })
    vcsMock.diff.mockResolvedValue({ data: [] })
  })

  it('routes workspace operations through the explicit server scope', async () => {
    const scope = { serverID: 'remote', workspace: 'workspace-a' }

    await expect(getVcsInfo(scope)).resolves.toEqual({ branch: 'main' })
    await expect(getVcsDiff('working', scope)).resolves.toEqual([])

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(vcsMock.get).toHaveBeenCalledWith({ workspace: 'workspace-a' })
    expect(vcsMock.diff).toHaveBeenCalledWith({ mode: 'working', workspace: 'workspace-a' })
  })

  it('preserves the legacy directory call shape', async () => {
    await getVcsInfo('/legacy')

    expect(getSDKClientMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/legacy' })
    expect(vcsMock.get).toHaveBeenCalledWith({ directory: '/legacy' })
  })
})

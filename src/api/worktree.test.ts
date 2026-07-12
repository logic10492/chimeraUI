import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveServerIdMock, getSDKClientMock, worktreeMock } = vi.hoisted(() => ({
  getActiveServerIdMock: vi.fn(() => 'local'),
  getSDKClientMock: vi.fn(),
  worktreeMock: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), reset: vi.fn() },
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

import { createWorktree, listWorktrees, removeWorktree, resetWorktree } from './worktree'

describe('worktree API scope wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSDKClientMock.mockReturnValue({ worktree: worktreeMock })
    worktreeMock.list.mockResolvedValue({ data: ['/repo'] })
    worktreeMock.create.mockResolvedValue({ data: { name: 'feature', directory: '/repo/feature' } })
    worktreeMock.remove.mockResolvedValue({ data: true })
    worktreeMock.reset.mockResolvedValue({ data: true })
  })

  it('routes every operation through an explicit workspace scope', async () => {
    const scope = { serverID: 'remote', workspace: 'workspace-a' }
    const create = { name: 'feature' }
    const remove = { directory: '/repo/feature' }
    const reset = { directory: '/repo/feature' }

    await listWorktrees(scope)
    await createWorktree(create, scope)
    await removeWorktree(remove, scope)
    await resetWorktree(reset, scope)

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(worktreeMock.list).toHaveBeenCalledWith({ workspace: 'workspace-a' })
    expect(worktreeMock.create).toHaveBeenCalledWith({ workspace: 'workspace-a', worktreeCreateInput: create })
    expect(worktreeMock.remove).toHaveBeenCalledWith({ workspace: 'workspace-a', worktreeRemoveInput: remove })
    expect(worktreeMock.reset).toHaveBeenCalledWith({ workspace: 'workspace-a', worktreeResetInput: reset })
  })

  it('preserves the legacy directory call shape', async () => {
    await listWorktrees('/legacy')

    expect(getSDKClientMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/legacy' })
    expect(worktreeMock.list).toHaveBeenCalledWith({ directory: '/legacy' })
  })
})

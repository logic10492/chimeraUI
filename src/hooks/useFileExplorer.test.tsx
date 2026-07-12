import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileExplorer } from './useFileExplorer'
import { changeScopeStore } from '../store/changeScopeStore'
import { runtimeInvalidationStore } from '../store/runtimeInvalidationStore'
import { activeSessionStore } from '../store/activeSessionStore'

const { listDirectory, getFileContent, getFileStatus, getSessionDiff, getLastTurnDiff, getVcsDiff, getActiveServerId } =
  vi.hoisted(() => ({
    listDirectory: vi.fn(),
    getFileContent: vi.fn(),
    getFileStatus: vi.fn(),
    getSessionDiff: vi.fn(),
    getLastTurnDiff: vi.fn(),
    getVcsDiff: vi.fn(),
    getActiveServerId: vi.fn(() => 'local'),
  }))

vi.mock('../api', () => ({
  listDirectory,
  getFileContent,
  getFileStatus,
  getSessionDiff,
  getLastTurnDiff,
  getVcsDiff,
}))

vi.mock('../store/serverStore', () => ({
  serverStore: { getActiveServerId },
}))

describe('useFileExplorer change scope', () => {
  beforeEach(() => {
    changeScopeStore.clearAll()
    vi.clearAllMocks()
    getActiveServerId.mockReturnValue('local')

    listDirectory.mockResolvedValue([
      { name: 'src', path: 'src', absolute: '/repo/src', type: 'directory', ignored: false },
      { name: 'session.ts', path: 'src/session.ts', absolute: '/repo/src/session.ts', type: 'file', ignored: false },
      { name: 'turn.ts', path: 'src/turn.ts', absolute: '/repo/src/turn.ts', type: 'file', ignored: false },
    ])
    getFileContent.mockResolvedValue({ type: 'text', content: 'test' })
    getFileStatus.mockResolvedValue([])
    getVcsDiff.mockResolvedValue([])
    getSessionDiff.mockResolvedValue([
      {
        file: 'src/session.ts',
        before: 'const session = 1',
        after: 'const session = 2',
        additions: 1,
        deletions: 1,
      },
    ])
    getLastTurnDiff.mockResolvedValue([
      {
        file: 'src/turn.ts',
        before: '',
        after: 'const turn = 1',
        additions: 1,
        deletions: 0,
      },
    ])
  })

  it('updates file statuses when the shared change mode changes', async () => {
    const { result } = renderHook(() => useFileExplorer({ directory: '/repo', autoLoad: true, sessionId: 'session-1' }))

    await waitFor(() => {
      expect(result.current.fileStatus.get('src/turn.ts')?.status).toBe('added')
    })

    expect(getLastTurnDiff).toHaveBeenCalledWith('session-1', '/repo')

    act(() => {
      changeScopeStore.setMode('session-1', 'session')
    })

    await waitFor(() => {
      expect(result.current.fileStatus.get('src/session.ts')?.status).toBe('modified')
    })

    expect(result.current.fileStatus.get('src/turn.ts')).toBeUndefined()
    expect(getSessionDiff).toHaveBeenCalledWith('session-1', '/repo')
  })

  it('restores expanded folders per directory when switching projects', async () => {
    listDirectory.mockImplementation(async (parentPath: string, directory: string) => {
      if (parentPath === '') {
        return [{ name: 'src', path: 'src', absolute: `${directory}/src`, type: 'directory', ignored: false }]
      }

      if (parentPath === 'src') {
        return [
          {
            name: directory === '/repo-a' ? 'a.ts' : 'b.ts',
            path: `src/${directory === '/repo-a' ? 'a.ts' : 'b.ts'}`,
            absolute: `${directory}/src/${directory === '/repo-a' ? 'a.ts' : 'b.ts'}`,
            type: 'file',
            ignored: false,
          },
        ]
      }

      return []
    })

    const { result, rerender } = renderHook(({ directory }) => useFileExplorer({ directory, autoLoad: true }), {
      initialProps: { directory: '/repo-a' },
    })

    await waitFor(() => {
      expect(result.current.tree).toHaveLength(1)
    })

    act(() => {
      result.current.toggleExpand('src')
    })

    await waitFor(() => {
      expect(result.current.expandedPaths.has('src')).toBe(true)
      expect(result.current.tree[0]?.children?.[0]?.path).toBe('src/a.ts')
    })

    rerender({ directory: '/repo-b' })

    await waitFor(() => {
      expect(result.current.tree[0]?.absolute).toBe('/repo-b/src')
      expect(result.current.tree[0]?.children?.[0]?.path).toBeUndefined()
      expect(result.current.expandedPaths.has('src')).toBe(false)
    })

    rerender({ directory: '/repo-a' })

    await waitFor(() => {
      expect(result.current.tree[0]?.absolute).toBe('/repo-a/src')
      expect(result.current.expandedPaths.has('src')).toBe(true)
      expect(result.current.tree[0]?.children?.[0]?.path).toBe('src/a.ts')
    })
  })

  it('ignores stale child loads after switching directories', async () => {
    let resolveRepoAChildren: (
      nodes: Array<{ name: string; path: string; absolute: string; type: 'file'; ignored: boolean }>,
    ) => void

    listDirectory.mockImplementation((parentPath: string, directory: string) => {
      if (parentPath === '') {
        return Promise.resolve([
          { name: 'src', path: 'src', absolute: `${directory}/src`, type: 'directory', ignored: false },
        ])
      }

      if (parentPath === 'src' && directory === '/repo-a') {
        return new Promise(resolve => {
          resolveRepoAChildren = resolve
        })
      }

      if (parentPath === 'src' && directory === '/repo-b') {
        return Promise.resolve([
          { name: 'b.ts', path: 'src/b.ts', absolute: '/repo-b/src/b.ts', type: 'file', ignored: false },
        ])
      }

      return Promise.resolve([])
    })

    const { result, rerender } = renderHook(({ directory }) => useFileExplorer({ directory, autoLoad: true }), {
      initialProps: { directory: '/repo-a' },
    })

    await waitFor(() => {
      expect(result.current.tree[0]?.absolute).toBe('/repo-a/src')
    })

    act(() => {
      result.current.toggleExpand('src')
    })

    rerender({ directory: '/repo-b' })

    await waitFor(() => {
      expect(result.current.tree[0]?.absolute).toBe('/repo-b/src')
    })

    act(() => {
      result.current.toggleExpand('src')
    })

    await waitFor(() => {
      expect(result.current.tree[0]?.children?.[0]?.path).toBe('src/b.ts')
    })

    await act(async () => {
      resolveRepoAChildren!([
        { name: 'a.ts', path: 'src/a.ts', absolute: '/repo-a/src/a.ts', type: 'file', ignored: false },
      ])
    })

    expect(result.current.tree[0]?.absolute).toBe('/repo-b/src')
    expect(result.current.tree[0]?.children?.map(child => child.path)).toEqual(['src/b.ts'])
  })

  it('reacts only to runtime invalidations for the active server and directory', async () => {
    renderHook(() => useFileExplorer({ directory: '/repo', autoLoad: true }))

    await waitFor(() => {
      expect(listDirectory).toHaveBeenCalledTimes(1)
    })

    act(() => {
      runtimeInvalidationStore.emit({
        type: 'file',
        scope: { serverID: 'remote', directory: '/repo' },
        event: 'change',
      })
      runtimeInvalidationStore.emit({
        type: 'file',
        scope: { serverID: 'local', directory: '/other' },
        event: 'change',
      })
    })
    await act(async () => {})

    expect(listDirectory).toHaveBeenCalledTimes(1)

    act(() => {
      runtimeInvalidationStore.emit({
        type: 'file',
        scope: { serverID: 'local', directory: '/repo' },
        event: 'change',
      })
    })

    await waitFor(() => {
      expect(listDirectory).toHaveBeenCalledTimes(2)
    })
  })

  it('clears same-directory tree and preview before loading the switched server', async () => {
    let resolveRemoteTree!: (
      nodes: Array<{ name: string; path: string; absolute: string; type: 'file'; ignored: boolean }>,
    ) => void
    let resolveRemotePreview!: (content: { type: 'text'; content: string }) => void
    listDirectory
      .mockResolvedValueOnce([
        { name: 'old.ts', path: 'old.ts', absolute: '/repo/old.ts', type: 'file', ignored: false },
      ])
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveRemoteTree = resolve
          }),
      )
    getFileContent.mockResolvedValueOnce({ type: 'text', content: 'old server' }).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRemotePreview = resolve
        }),
    )

    const { result } = renderHook(() => useFileExplorer({ directory: '/repo', autoLoad: true }))
    await waitFor(() => expect(result.current.tree[0]?.path).toBe('old.ts'))
    await act(async () => {
      await result.current.loadPreview('old.ts')
    })
    expect(result.current.previewContent).toEqual({ type: 'text', content: 'old server' })

    getActiveServerId.mockReturnValue('remote')
    act(() => {
      runtimeInvalidationStore.emit({
        type: 'file',
        scope: { serverID: 'remote', directory: 'global' },
        event: 'resync',
      })
    })

    await waitFor(() => {
      expect(result.current.tree).toEqual([])
      expect(result.current.previewContent).toBeNull()
    })

    await act(async () => {
      resolveRemoteTree([{ name: 'new.ts', path: 'new.ts', absolute: '/repo/new.ts', type: 'file', ignored: false }])
      resolveRemotePreview({ type: 'text', content: 'new server' })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.tree[0]?.path).toBe('new.ts')
      expect(result.current.previewContent).toEqual({ type: 'text', content: 'new server' })
    })
  })

  it('isolates workspace-scoped file invalidations for a session explorer', async () => {
    activeSessionStore.setSessionMeta('workspace-session', 'Workspace session', '/repo', 'local', 'workspace-a')
    renderHook(() => useFileExplorer({ directory: '/repo', autoLoad: true, sessionId: 'workspace-session' }))
    await waitFor(() => expect(listDirectory).toHaveBeenCalledTimes(1))

    act(() => {
      runtimeInvalidationStore.emit({
        type: 'file',
        scope: { serverID: 'local', directory: '/repo', workspace: 'workspace-b' },
        event: 'change',
      })
    })
    await act(async () => {})
    expect(listDirectory).toHaveBeenCalledTimes(1)

    act(() => {
      runtimeInvalidationStore.emit({
        type: 'file',
        scope: { serverID: 'local', directory: '/repo', workspace: 'workspace-a' },
        event: 'change',
      })
    })
    await waitFor(() => expect(listDirectory).toHaveBeenCalledTimes(2))
    activeSessionStore.removeSession('workspace-session', 'local')
  })

  it.each(['edited', 'change'] as const)(
    'reloads a matching preview for a normalized absolute path on %s',
    async event => {
      getFileContent.mockResolvedValueOnce({ type: 'text', content: 'before' }).mockResolvedValueOnce({
        type: 'text',
        content: 'after',
      })
      const { result } = renderHook(() => useFileExplorer({ directory: '/repo', autoLoad: true }))

      await act(async () => {
        await result.current.loadPreview('src/session.ts')
      })
      expect(result.current.previewContent).toEqual({ type: 'text', content: 'before' })

      act(() => {
        runtimeInvalidationStore.emit({
          type: 'file',
          scope: { serverID: 'local', directory: '/repo' },
          file: '/repo/src/session.ts',
          event,
        })
      })

      await waitFor(() => {
        expect(result.current.previewContent).toEqual({ type: 'text', content: 'after' })
      })
      expect(getFileContent).toHaveBeenNthCalledWith(2, 'src/session.ts', '/repo')
    },
  )

  it.each(['unlink', 'disposed'] as const)('clears a matching preview on %s', async event => {
    const { result } = renderHook(() => useFileExplorer({ directory: '/repo', autoLoad: true }))

    await act(async () => {
      await result.current.loadPreview('src/session.ts')
    })
    expect(result.current.previewContent).toEqual({ type: 'text', content: 'test' })

    act(() => {
      runtimeInvalidationStore.emit({
        type: 'file',
        scope: { serverID: 'local', directory: '/repo' },
        file: '/repo/src/session.ts',
        event,
      })
    })

    await waitFor(() => {
      expect(result.current.previewContent).toBeNull()
    })
    expect(getFileContent).toHaveBeenCalledTimes(1)
  })
})

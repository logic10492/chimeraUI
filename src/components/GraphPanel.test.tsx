import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphPanel } from './GraphPanel'

const {
  getGraphStatusMock,
  searchGraphMock,
  getGraphFileSymbolsMock,
  getGraphImpactMock,
  searchSymbolsMock,
  getLspStatusesMock,
  getFormatterStatusesMock,
  openFilePreviewMock,
  layoutState,
} = vi.hoisted(() => ({
  getGraphStatusMock: vi.fn(),
  searchGraphMock: vi.fn(),
  getGraphFileSymbolsMock: vi.fn(),
  getGraphImpactMock: vi.fn(),
  searchSymbolsMock: vi.fn(),
  getLspStatusesMock: vi.fn(),
  getFormatterStatusesMock: vi.fn(),
  openFilePreviewMock: vi.fn(),
  layoutState: {
    panelTabs: [] as Array<{
      id: string
      type: 'files'
      position: 'right' | 'bottom'
      previewFile: { path: string; name: string }
    }>,
    activeTabId: { right: null as string | null, bottom: null as string | null },
  },
}))

vi.mock('../api/graph', () => ({
  getGraphStatus: (...args: unknown[]) => getGraphStatusMock(...args),
  searchGraph: (...args: unknown[]) => searchGraphMock(...args),
  getGraphFileSymbols: (...args: unknown[]) => getGraphFileSymbolsMock(...args),
  getGraphImpact: (...args: unknown[]) => getGraphImpactMock(...args),
}))

vi.mock('../api/file', () => ({
  searchSymbols: (...args: unknown[]) => searchSymbolsMock(...args),
}))

vi.mock('../api/lsp', () => ({
  getLspStatuses: (...args: unknown[]) => getLspStatusesMock(...args),
  getFormatterStatuses: (...args: unknown[]) => getFormatterStatusesMock(...args),
}))

vi.mock('../store/layoutStore', () => ({
  useLayoutStore: () => layoutState,
  layoutStore: { openFilePreview: openFilePreviewMock },
}))

vi.mock('../utils', () => ({
  apiErrorHandler: vi.fn(),
}))

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

const scope = { serverID: 'remote', workspace: 'workspace-a' }
const baseStatus = {
  initialized: true,
  projectRoot: '/repo',
  dataRoot: '/repo/.chimera',
  dataRootStatus: 'current',
  jobStatus: null,
}

describe('GraphPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    layoutState.panelTabs = [
      {
        id: 'files',
        type: 'files',
        position: 'right',
        previewFile: { path: 'src/current.ts', name: 'current.ts' },
      },
    ]
    layoutState.activeTabId = { right: 'files', bottom: null }
    getGraphStatusMock.mockResolvedValue(baseStatus)
    getLspStatusesMock.mockResolvedValue([{ id: 'ts', name: 'TypeScript', root: '/repo', status: 'connected' }])
    getFormatterStatusesMock.mockResolvedValue([{ name: 'prettier', extensions: ['.ts'], enabled: true }])
    searchGraphMock.mockResolvedValue({ ...baseStatus, results: [] })
    getGraphFileSymbolsMock.mockResolvedValue({ ...baseStatus, path: 'src/current.ts', results: [] })
    getGraphImpactMock.mockResolvedValue({ ...baseStatus, results: [] })
    searchSymbolsMock.mockResolvedValue([])
  })

  it('keeps graph queries disabled when data is uninitialized while workspace search remains available', async () => {
    getGraphStatusMock.mockResolvedValue({
      ...baseStatus,
      initialized: false,
      dataRootStatus: 'uninitialized',
    })
    searchSymbolsMock.mockResolvedValue([
      {
        name: 'WorkspaceThing',
        kind: 12,
        location: {
          uri: 'file:///repo/src/workspace.ts',
          range: { start: { line: 4, character: 0 }, end: { line: 4, character: 10 } },
        },
      },
    ])

    render(<GraphPanel apiScope={scope} />)

    await waitFor(() => expect(screen.getByText('uninitialized')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Workspace Symbols' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Query' }), { target: { value: 'WorkspaceThing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(searchSymbolsMock).toHaveBeenCalledWith('WorkspaceThing', scope))
    expect(await screen.findByText('WorkspaceThing')).toBeInTheDocument()
  })

  it('runs graph search and opens matching files in the existing preview surface', async () => {
    searchGraphMock.mockResolvedValue({
      ...baseStatus,
      results: [
        {
          score: 1,
          node: {
            name: 'GraphPanel',
            kind: 'component',
            filePath: 'src/components/GraphPanel.tsx',
            startLine: 1,
          },
        },
      ],
    })

    render(<GraphPanel apiScope={scope} />)

    await waitFor(() => expect(getGraphStatusMock).toHaveBeenCalledWith(scope))
    fireEvent.change(screen.getByRole('textbox', { name: 'Query' }), { target: { value: 'GraphPanel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(await screen.findByText('GraphPanel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open src/components/GraphPanel.tsx' }))

    expect(searchGraphMock).toHaveBeenCalledWith({ query: 'GraphPanel', kind: undefined, limit: 20 }, scope)
    expect(openFilePreviewMock).toHaveBeenCalledWith({
      path: 'src/components/GraphPanel.tsx',
      name: 'GraphPanel.tsx',
    })
  })

  it('uses the current preview file for file-symbol queries', async () => {
    render(<GraphPanel apiScope={scope} />)

    await waitFor(() => expect(getGraphStatusMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'File Symbols' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use open file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() =>
      expect(getGraphFileSymbolsMock).toHaveBeenCalledWith(
        {
          path: 'src/current.ts',
          kind: undefined,
          startLine: undefined,
          endLine: undefined,
          limit: 50,
        },
        scope,
      ),
    )
  })

  it('clears loading state on a mode switch and ignores the stale query resolution', async () => {
    const pending = deferred<{ results: Array<{ node: { name: string } }> }>()
    searchGraphMock.mockReturnValue(pending.promise)
    searchSymbolsMock.mockResolvedValue([
      {
        name: 'FreshWorkspaceResult',
        kind: 12,
        location: {
          uri: 'file:///repo/src/fresh.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        },
      },
    ])

    const { container } = render(<GraphPanel apiScope={scope} />)

    await waitFor(() => expect(getGraphStatusMock).toHaveBeenCalled())
    const resultsRegion = container.querySelector('[aria-live="polite"][aria-busy]')
    expect(resultsRegion).toHaveAttribute('aria-live', 'polite')

    fireEvent.change(screen.getByRole('textbox', { name: 'Query' }), { target: { value: 'pending' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(resultsRegion).toHaveAttribute('aria-busy', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Workspace Symbols' }))
    expect(screen.getByRole('button', { name: 'Run' })).not.toBeDisabled()
    expect(resultsRegion).toHaveAttribute('aria-busy', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('FreshWorkspaceResult')).toBeInTheDocument()

    await act(async () => {
      pending.resolve({ results: [{ node: { name: 'StaleGraphResult' } }] })
      await pending.promise
    })

    expect(screen.queryByText('StaleGraphResult')).not.toBeInTheDocument()
    expect(screen.getByText('FreshWorkspaceResult')).toBeInTheDocument()
  })

  it('clears loading state on a scope change and ignores the stale query resolution', async () => {
    const pending = deferred<{ results: Array<{ node: { name: string } }> }>()
    searchGraphMock.mockReturnValue(pending.promise)
    const { container, rerender } = render(<GraphPanel apiScope={scope} />)

    await waitFor(() => expect(getGraphStatusMock).toHaveBeenCalledWith(scope))
    fireEvent.change(screen.getByRole('textbox', { name: 'Query' }), { target: { value: 'pending' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()

    const nextScope = { serverID: 'remote', workspace: 'workspace-b' }
    rerender(<GraphPanel apiScope={nextScope} />)

    await waitFor(() => expect(getGraphStatusMock).toHaveBeenCalledWith(nextScope))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).not.toBeDisabled())
    expect(container.querySelector('[aria-live="polite"][aria-busy]')).toHaveAttribute('aria-busy', 'false')

    await act(async () => {
      pending.resolve({ results: [{ node: { name: 'StaleScopeResult' } }] })
      await pending.promise
    })

    expect(screen.queryByText('StaleScopeResult')).not.toBeInTheDocument()
    expect(screen.getByText('Choose a read-only query and run it.')).toBeInTheDocument()
  })

  it('uses the active files tab when multiple files tabs exist', async () => {
    layoutState.panelTabs = [
      {
        id: 'inactive-right-files',
        type: 'files',
        position: 'right',
        previewFile: { path: 'src/inactive.ts', name: 'inactive.ts' },
      },
      {
        id: 'active-bottom-files',
        type: 'files',
        position: 'bottom',
        previewFile: { path: 'src/active.ts', name: 'active.ts' },
      },
    ]
    layoutState.activeTabId = { right: null, bottom: 'active-bottom-files' }

    render(<GraphPanel apiScope={scope} />)

    await waitFor(() => expect(getGraphStatusMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'File Symbols' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use open file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() =>
      expect(getGraphFileSymbolsMock).toHaveBeenCalledWith(
        {
          path: 'src/active.ts',
          kind: undefined,
          startLine: undefined,
          endLine: undefined,
          limit: 50,
        },
        scope,
      ),
    )
  })
})

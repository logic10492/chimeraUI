import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getGraphFileSymbols, getGraphImpact, getGraphStatus, searchGraph } from './graph'

const { client, getSDKClientMock } = vi.hoisted(() => {
  const client = {
    graph: {
      status: vi.fn(),
      search: vi.fn(),
      impact: vi.fn(),
      file: { symbols: vi.fn() },
    },
  }
  return { client, getSDKClientMock: vi.fn(() => client) }
})

vi.mock('./sdk', () => ({
  getSDKClient: getSDKClientMock,
  unwrap: <T>(result: { data?: T; error?: unknown }) => {
    if (result.error) throw result.error
    return result.data as T
  },
}))

describe('graph API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes directory status requests through the resolved server scope', async () => {
    const response = {
      initialized: false,
      projectRoot: '/repo',
      dataRoot: '/repo/.chimera',
      dataRootStatus: 'uninitialized',
      jobStatus: null,
    }
    client.graph.status.mockResolvedValue({ data: response })

    await expect(getGraphStatus('/repo')).resolves.toBe(response)

    expect(getSDKClientMock).toHaveBeenCalledWith(expect.objectContaining({ directory: '/repo' }))
    expect(client.graph.status).toHaveBeenCalledWith({ directory: '/repo' })
  })

  it('preserves explicit server and workspace routing for search', async () => {
    const scope = { serverID: 'remote', workspace: 'workspace-1' }
    const response = {
      initialized: true,
      projectRoot: '/repo',
      dataRoot: '/data',
      dataRootStatus: 'current',
      jobStatus: null,
      results: [],
    }
    client.graph.search.mockResolvedValue({ data: response })

    await expect(searchGraph({ query: 'session', kind: 'function', limit: 7 }, scope)).resolves.toBe(response)

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(client.graph.search).toHaveBeenCalledWith({
      workspace: 'workspace-1',
      query: 'session',
      kind: 'function',
      limit: 7,
    })
  })

  it('converts generated file-symbol line parameters to strings', async () => {
    client.graph.file.symbols.mockResolvedValue({ data: { results: [] } })

    await getGraphFileSymbols(
      { path: 'src/index.ts', startLine: 3, endLine: 9, limit: 4 },
      { serverID: 'remote', directory: '/repo' },
    )

    expect(client.graph.file.symbols).toHaveBeenCalledWith({
      directory: '/repo',
      path: 'src/index.ts',
      startLine: '3',
      endLine: '9',
      limit: 4,
    })
  })

  it('converts generated impact depth parameters to strings', async () => {
    client.graph.impact.mockResolvedValue({ data: { results: [] } })

    await getGraphImpact({ nodeID: 'node:1', depth: 2 }, { serverID: 'remote', workspace: 'workspace-1' })

    expect(client.graph.impact).toHaveBeenCalledWith({ workspace: 'workspace-1', nodeID: 'node:1', depth: '2' })
  })

  it('propagates SDK errors', async () => {
    const error = new Error('graph unavailable')
    client.graph.status.mockResolvedValue({ error })

    await expect(getGraphStatus({ serverID: 'remote', directory: '/repo' })).rejects.toBe(error)
  })
})

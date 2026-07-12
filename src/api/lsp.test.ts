import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFormatterStatus, getFormatterStatuses, getLspStatus, getLspStatuses } from './lsp'

const { client, getSDKClientMock } = vi.hoisted(() => {
  const client = {
    lsp: { status: vi.fn() },
    formatter: { status: vi.fn() },
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

describe('LSP API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('preserves the complete LSP status list and directory routing', async () => {
    const statuses = [
      { id: 'ts-1', name: 'typescript', root: '/repo', status: 'connected' as const },
      { id: 'eslint-1', name: 'eslint', root: '/repo', status: 'error' as const },
    ]
    client.lsp.status.mockResolvedValue({ data: statuses })

    await expect(getLspStatuses('/repo')).resolves.toBe(statuses)

    expect(getSDKClientMock).toHaveBeenCalledWith(expect.objectContaining({ directory: '/repo' }))
    expect(client.lsp.status).toHaveBeenCalledWith({ directory: '/repo' })
  })

  it('preserves the complete formatter list with explicit server and workspace routing', async () => {
    const scope = { serverID: 'remote', workspace: 'workspace-1' }
    const statuses = [
      { name: 'prettier', extensions: ['.ts'], enabled: true },
      { name: 'biome', extensions: ['.js'], enabled: false },
    ]
    client.formatter.status.mockResolvedValue({ data: statuses })

    await expect(getFormatterStatuses(scope)).resolves.toBe(statuses)

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(client.formatter.status).toHaveBeenCalledWith({ workspace: 'workspace-1' })
  })

  it('keeps the legacy LSP projection based on the first list item', async () => {
    client.lsp.status.mockResolvedValue({
      data: [
        { id: 'ts-1', name: 'typescript', root: '/repo', status: 'connected' },
        { id: 'eslint-1', name: 'eslint', root: '/repo', status: 'error' },
      ],
    })

    await expect(getLspStatus({ serverID: 'remote', directory: '/repo' })).resolves.toEqual({
      running: true,
      language: 'typescript',
    })
  })

  it('keeps the legacy formatter projection and empty fallback', async () => {
    client.formatter.status.mockResolvedValueOnce({
      data: [
        { name: 'prettier', extensions: ['.ts'], enabled: true },
        { name: 'biome', extensions: ['.js'], enabled: false },
      ],
    })
    client.formatter.status.mockResolvedValueOnce({ data: [] })

    await expect(getFormatterStatus({ serverID: 'remote', workspace: 'workspace-1' })).resolves.toEqual({
      available: true,
      name: 'prettier',
    })
    await expect(getFormatterStatus('/repo')).resolves.toEqual({ available: false })
  })

  it('propagates SDK errors from list and projection helpers', async () => {
    const lspError = new Error('lsp unavailable')
    const formatterError = new Error('formatter unavailable')
    client.lsp.status.mockResolvedValue({ error: lspError })
    client.formatter.status.mockResolvedValue({ error: formatterError })

    await expect(getLspStatuses('/repo')).rejects.toBe(lspError)
    await expect(getFormatterStatus('/repo')).rejects.toBe(formatterError)
  })
})

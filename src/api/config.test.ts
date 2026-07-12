import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProvidersResponse } from '../types/api/model'
import { getConfig, getProviderConfigs, providerCatalog, providerModelChoices, updateConfig } from './config'

const { client, getSDKClientMock } = vi.hoisted(() => {
  const client = {
    config: {
      get: vi.fn(),
      update: vi.fn(),
      providers: vi.fn(),
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

const response = {
  providers: [
    { id: 'alpha', name: 'Alpha', source: 'api', env: [], options: {}, models: { one: {}, two: {} } },
    { id: 'beta', name: 'Beta', source: 'config', env: [], options: {}, models: { three: {} } },
  ],
  default: { alpha: 'one' },
} as unknown as ProvidersResponse

describe('config provider response parsing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('indexes the providers array by provider id', () => {
    expect(Object.keys(providerCatalog(response))).toEqual(['alpha', 'beta'])
    expect(providerCatalog(response).alpha.name).toBe('Alpha')
  })

  it('builds model choices from the providers array instead of response object keys', () => {
    expect(providerModelChoices(response)).toEqual([
      { value: 'alpha/one', label: 'alpha/one' },
      { value: 'alpha/two', label: 'alpha/two' },
      { value: 'beta/three', label: 'beta/three' },
    ])
  })

  it('preserves explicit server and workspace scope for config reads, writes, and provider catalogs', async () => {
    const scope = { serverID: 'remote', workspace: 'workspace-1' }
    const config = { model: 'alpha/one' }
    client.config.get.mockResolvedValue({ data: config })
    client.config.update.mockResolvedValue({ data: config })
    client.config.providers.mockResolvedValue({ data: response })

    await getConfig(scope)
    await updateConfig(config, scope)
    await getProviderConfigs(scope)

    expect(getSDKClientMock).toHaveBeenNthCalledWith(1, scope)
    expect(getSDKClientMock).toHaveBeenNthCalledWith(2, scope)
    expect(getSDKClientMock).toHaveBeenNthCalledWith(3, scope)
    expect(client.config.get).toHaveBeenCalledWith({ workspace: 'workspace-1' })
    expect(client.config.update).toHaveBeenCalledWith({ workspace: 'workspace-1', config })
    expect(client.config.providers).toHaveBeenCalledWith({ workspace: 'workspace-1' })
  })
})

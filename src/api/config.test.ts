import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProvidersResponse } from '../types/api/model'
import {
  getConfig,
  getProviderConfigs,
  getRemoteCompactionEligibility,
  getRemoteCompactionStatus,
  providerCatalog,
  providerModelChoices,
  updateConfig,
  updateRemoteCompactionEligibility,
  updateRemoteCompactionPolicy,
} from './config'

const { client, getSDKClientMock } = vi.hoisted(() => {
  const client = {
    config: {
      get: vi.fn(),
      update: vi.fn(),
      providers: vi.fn(),
      remoteCompaction: {
        status: vi.fn(),
        update: vi.fn(),
        eligibility: {
          list: vi.fn(),
          update: vi.fn(),
        },
      },
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

  it('routes remote compaction status through focused session directory scope with exact identity query', async () => {
    const scope = { serverID: 'remote', directory: '/workspace/project' }
    const status = { mode: 'local' }
    client.config.remoteCompaction.status.mockResolvedValue({ data: status })

    await expect(
      getRemoteCompactionStatus({ providerID: 'provider-a', modelID: 'model-a', sessionID: 'session-a' }, scope),
    ).resolves.toBe(status)

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(client.config.remoteCompaction.status).toHaveBeenCalledWith({
      directory: '/workspace/project',
      providerID: 'provider-a',
      modelID: 'model-a',
      sessionID: 'session-a',
    })
  })

  it('routes remote compaction policy updates through workspace scope with only the narrow patch', async () => {
    const scope = { serverID: 'remote', workspace: 'workspace-1' }
    const policy = { remote: 'auto', remote_protocol: 'v2' }
    client.config.remoteCompaction.update.mockResolvedValue({ data: policy })

    await expect(updateRemoteCompactionPolicy({ remote_protocol: 'v2' }, 'session-a', scope)).resolves.toBe(policy)

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(client.config.remoteCompaction.update).toHaveBeenCalledWith({
      workspace: 'workspace-1',
      remoteCompactionPolicyPatch: { remote_protocol: 'v2' },
    })
  })

  it('routes eligibility list and updates through project scope with the exact SDK payload', async () => {
    const scope = { serverID: 'remote', directory: '/workspace/project' }
    const list = { items: [] }
    const updated = { providerID: 'provider-a', modelID: 'model-a', configurable: true }
    client.config.remoteCompaction.eligibility.list.mockResolvedValue({ data: list })
    client.config.remoteCompaction.eligibility.update.mockResolvedValue({ data: updated })

    await expect(getRemoteCompactionEligibility(scope)).resolves.toBe(list)
    await expect(
      updateRemoteCompactionEligibility(
        {
          providerID: 'provider-a',
          modelID: 'model-a',
          enabled: true,
          protocols: ['v2', 'legacy'],
        },
        scope,
      ),
    ).resolves.toBe(updated)

    expect(client.config.remoteCompaction.eligibility.list).toHaveBeenCalledWith({ directory: '/workspace/project' })
    expect(client.config.remoteCompaction.eligibility.update).toHaveBeenCalledWith({
      directory: '/workspace/project',
      remoteCompactionEligibilityPatch: {
        providerID: 'provider-a',
        modelID: 'model-a',
        enabled: true,
        protocols: ['v2', 'legacy'],
      },
    })
  })
})

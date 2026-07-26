import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProvidersResponse } from '../types/api/model'
import {
  getConfig,
  getProviderConfigs,
  getRemoteCompactionEligibility,
  getRemoteCompactionPolicy,
  getRemoteCompactionStatus,
  providerCatalog,
  providerModelChoices,
  updateConfig,
  updateRemoteCompactionEligibility,
  updateRemoteCompactionPolicy,
} from './config'

const { client, getSDKClientMock, transport } = vi.hoisted(() => {
  const transport = {
    get: vi.fn(),
    patch: vi.fn(),
  }
  const client = {
    client: transport,
    config: {
      get: vi.fn(),
      update: vi.fn(),
      providers: vi.fn(),
    },
  }
  return { client, getSDKClientMock: vi.fn(() => client), transport }
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
    transport.get.mockResolvedValue({ data: status })

    await expect(
      getRemoteCompactionStatus({ providerID: 'provider-a', modelID: 'model-a', sessionID: 'session-a' }, scope),
    ).resolves.toBe(status)

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(transport.get).toHaveBeenCalledWith({
      url: '/config/remote-compaction/status',
      query: {
        directory: '/workspace/project',
        providerID: 'provider-a',
        modelID: 'model-a',
        sessionID: 'session-a',
      },
    })
  })

  it('reads policy provenance and routes narrow policy updates through the typed transport', async () => {
    const scope = { serverID: 'remote', workspace: 'workspace-1' }
    const policy = {
      remote: 'auto',
      remote_protocol: 'v2',
      metadata: {
        remote: { source: 'global', explicitAtWriteTarget: false },
        remote_protocol: { source: 'project', explicitAtWriteTarget: true },
        writeTarget: { source: 'project', format: 'json', exists: true },
      },
    }
    transport.get.mockResolvedValue({ data: policy })
    transport.patch.mockResolvedValue({ data: policy })

    await expect(getRemoteCompactionPolicy(scope)).resolves.toBe(policy)
    await expect(updateRemoteCompactionPolicy({ remote_protocol: null }, 'session-a', scope)).resolves.toBe(policy)

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(transport.get).toHaveBeenCalledWith({
      url: '/config/remote-compaction',
      query: { workspace: 'workspace-1' },
    })
    expect(transport.patch).toHaveBeenCalledWith({
      url: '/config/remote-compaction',
      query: { workspace: 'workspace-1' },
      body: { remote_protocol: null },
    })
  })

  it('routes eligibility list and updates through project scope with the exact transport payload', async () => {
    const scope = { serverID: 'remote', directory: '/workspace/project' }
    const list = { items: [] }
    const updated = { providerID: 'provider-a', modelID: 'model-a', configurable: true }
    transport.get.mockResolvedValue({ data: list })
    transport.patch.mockResolvedValue({ data: updated })

    await expect(getRemoteCompactionEligibility(scope)).resolves.toBe(list)
    await expect(
      updateRemoteCompactionEligibility(
        {
          providerID: 'provider-a',
          modelID: 'model-a',
          enabled: null,
        },
        scope,
      ),
    ).resolves.toBe(updated)

    expect(transport.get).toHaveBeenCalledWith({
      url: '/config/remote-compaction/eligibility',
      query: { directory: '/workspace/project' },
    })
    expect(transport.patch).toHaveBeenCalledWith({
      url: '/config/remote-compaction/eligibility',
      query: { directory: '/workspace/project' },
      body: {
        providerID: 'provider-a',
        modelID: 'model-a',
        enabled: null,
      },
    })
  })

  it('preserves patch, undefined session, and directory in the component policy call shape', async () => {
    const policy = { remote: 'on', remote_protocol: 'v2' }
    transport.patch.mockResolvedValue({ data: policy })

    await expect(updateRemoteCompactionPolicy({ remote: 'on' }, undefined, '/workspace/project')).resolves.toBe(policy)

    expect(getSDKClientMock).toHaveBeenCalledWith(expect.objectContaining({ directory: '/workspace/project' }))
    expect(transport.patch).toHaveBeenCalledWith({
      url: '/config/remote-compaction',
      query: { directory: '/workspace/project' },
      body: { remote: 'on' },
    })
  })
})

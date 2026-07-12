import { beforeEach, describe, expect, it, vi } from 'vitest'

const { client, getSDKClientMock } = vi.hoisted(() => {
  const client = {
    provider: {
      list: vi.fn(),
      auth: vi.fn(),
      oauth: { authorize: vi.fn(), callback: vi.fn() },
    },
    auth: { set: vi.fn(), remove: vi.fn() },
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

describe('provider API scope and auth flows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the explicit server and workspace scope for provider discovery', async () => {
    client.provider.list.mockResolvedValue({ data: { all: [], connected: [], default: {} } })
    const { listProviders } = await import('./provider')

    await listProviders({ serverID: 'remote', workspace: 'workspace-1' })

    expect(getSDKClientMock).toHaveBeenCalledWith({ serverID: 'remote', workspace: 'workspace-1' })
    expect(client.provider.list).toHaveBeenCalledWith({ workspace: 'workspace-1' })
  })

  it('lists auth methods with the selected server and workspace scope', async () => {
    client.provider.auth.mockResolvedValue({ data: { alpha: [{ type: 'api', label: 'API key' }] } })
    const { listProviderAuthMethods } = await import('./provider')
    const scope = { serverID: 'remote', workspace: 'workspace-1' }

    await expect(listProviderAuthMethods(scope)).resolves.toEqual({
      alpha: [{ type: 'api', label: 'API key' }],
    })

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(client.provider.auth).toHaveBeenCalledWith({ workspace: 'workspace-1' })
  })

  it('sends API keys through the SDK auth endpoint on the selected server', async () => {
    client.auth.set.mockResolvedValue({ data: true })
    const { connectProviderApiKey } = await import('./provider')

    await connectProviderApiKey('alpha', 'secret', { serverID: 'remote', directory: '/project' })

    expect(client.auth.set).toHaveBeenCalledWith({ providerID: 'alpha', auth: { type: 'api', key: 'secret' } })
  })

  it('disconnects credentials on the selected server', async () => {
    client.auth.remove.mockResolvedValue({ data: true })
    const { disconnectProvider } = await import('./provider')
    const scope = { serverID: 'remote', workspace: 'workspace-1' }

    await disconnectProvider('alpha', scope)

    expect(getSDKClientMock).toHaveBeenCalledWith(scope)
    expect(client.auth.remove).toHaveBeenCalledWith({ providerID: 'alpha' })
  })

  it('passes method, prompt inputs, and scope through OAuth authorize and callback', async () => {
    client.provider.oauth.authorize.mockResolvedValue({
      data: { url: 'https://auth.test', method: 'code', instructions: 'code' },
    })
    client.provider.oauth.callback.mockResolvedValue({ data: true })
    const { authorizeProviderOAuth, completeProviderOAuth } = await import('./provider')
    const scope = { serverID: 'remote', workspace: 'workspace-1' }

    await authorizeProviderOAuth('alpha', 2, { region: 'us' }, scope)
    await completeProviderOAuth('alpha', 2, '1234', scope)

    expect(client.provider.oauth.authorize).toHaveBeenCalledWith({
      providerID: 'alpha',
      workspace: 'workspace-1',
      method: 2,
      inputs: { region: 'us' },
    })
    expect(client.provider.oauth.callback).toHaveBeenCalledWith({
      providerID: 'alpha',
      workspace: 'workspace-1',
      method: 2,
      code: '1234',
    })
  })
})

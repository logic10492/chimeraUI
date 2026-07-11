import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createOpencodeClientMock, getActiveServerIdMock, getServerAuthMock, getServerBaseUrlMock, isTauriMock } =
  vi.hoisted(() => ({
    createOpencodeClientMock: vi.fn((config: unknown) => ({ config })),
    getActiveServerIdMock: vi.fn(() => 'local'),
    getServerAuthMock: vi.fn<(serverID: string) => { username: string; password: string } | null>(() => null),
    getServerBaseUrlMock: vi.fn((serverID: string) => `http://${serverID}.test`),
    isTauriMock: vi.fn(() => false),
  }))

vi.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: createOpencodeClientMock,
}))

vi.mock('../store/serverStore', () => ({
  makeBasicAuthHeader: vi.fn(
    (auth: { username: string; password: string }) => `Basic ${auth.username}:${auth.password}`,
  ),
  serverStore: {
    getActiveServerId: getActiveServerIdMock,
    getServerAuth: getServerAuthMock,
    getServerBaseUrl: getServerBaseUrlMock,
  },
}))

vi.mock('../utils/tauri', () => ({
  isTauri: isTauriMock,
}))

type MockClient = {
  config: {
    baseUrl: string
    headers: Record<string, string>
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }
}

describe('sdk request lifecycle', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    getActiveServerIdMock.mockReturnValue('local')
    getServerBaseUrlMock.mockImplementation(serverID => `http://${serverID}.test`)
    getServerAuthMock.mockReturnValue(null)
    isTauriMock.mockReturnValue(false)
    const { abortInFlightApiRequests, invalidateSDKClient } = await import('./sdk')
    abortInFlightApiRequests('reset test state')
    invalidateSDKClient()
  })

  it('isolates cached clients by explicit server even when directories match', async () => {
    const { getSDKClient } = await import('./sdk')
    getServerAuthMock.mockImplementation(serverID =>
      serverID === 'server-a' ? { username: 'a', password: 'secret-a' } : { username: 'b', password: 'secret-b' },
    )

    const serverA = getSDKClient({ serverID: 'server-a', directory: '/same' }) as unknown as MockClient
    const serverB = getSDKClient({ serverID: 'server-b', directory: '/same' }) as unknown as MockClient

    expect(serverA).not.toBe(serverB)
    expect(serverA.config.baseUrl).toBe('http://server-a.test')
    expect(serverB.config.baseUrl).toBe('http://server-b.test')
    expect(serverA.config.headers.Authorization).toBe('Basic a:secret-a')
    expect(serverB.config.headers.Authorization).toBe('Basic b:secret-b')

    getActiveServerIdMock.mockReturnValue('server-b')
    expect(getSDKClient({ serverID: 'server-a', directory: '/same' })).toBe(serverA)
  })

  it('aborts in-flight SDK requests when the server endpoint changes', async () => {
    const { abortInFlightApiRequests, getSDKClient } = await import('./sdk')
    let signal: AbortSignal | undefined

    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
      })
    })

    const client = getSDKClient() as unknown as MockClient
    const request = client.config.fetch('http://local.test/project/current')

    abortInFlightApiRequests('Server endpoint changed')

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal?.aborted).toBe(true)
  })

  it('prevents stale SDK clients from starting new requests after endpoint changes', async () => {
    const { abortInFlightApiRequests, getSDKClient } = await import('./sdk')
    const client = getSDKClient() as unknown as MockClient
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

    abortInFlightApiRequests('Server endpoint changed')

    await expect(client.config.fetch('http://local.test/project/current')).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

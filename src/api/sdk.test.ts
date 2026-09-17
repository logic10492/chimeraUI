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

  it('merges concurrent identical GET requests into one fetch and clones responses', async () => {
    const { getSDKClient } = await import('./sdk')
    let resolveFetch!: (value: Response) => void
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>(resolve => {
          resolveFetch = resolve
        }),
    )

    const client = getSDKClient() as unknown as MockClient
    const url = 'http://local.test/session?directory=%2Fone'
    const first = client.config.fetch(url)
    const second = client.config.fetch(url)

    // 同 method+URL 的并发 GET 只发一次网络请求（W3②）
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    resolveFetch(new Response('{"ok":true}', { status: 200 }))

    const [resA, resB] = await Promise.all([first, second])
    // 每个调用者拿到独立 clone，body 各自可读
    expect(resA).not.toBe(resB)
    await expect(resA.json()).resolves.toEqual({ ok: true })
    await expect(resB.json()).resolves.toEqual({ ok: true })
  })

  it('does not merge different URLs or non-GET requests', async () => {
    const { getSDKClient } = await import('./sdk')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

    const client = getSDKClient() as unknown as MockClient
    await Promise.all([
      client.config.fetch('http://local.test/a'),
      client.config.fetch('http://local.test/b'),
      client.config.fetch('http://local.test/a', { method: 'POST' }),
      client.config.fetch('http://local.test/a', { method: 'POST' }),
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  it('issues a fresh GET after the shared request settles', async () => {
    const { getSDKClient } = await import('./sdk')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

    const client = getSDKClient() as unknown as MockClient
    await client.config.fetch('http://local.test/session')
    await client.config.fetch('http://local.test/session')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('rejects only the aborted caller while other sharers still resolve', async () => {
    const { getSDKClient } = await import('./sdk')
    let resolveFetch!: (value: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>(resolve => {
          resolveFetch = resolve
        }),
    )

    const client = getSDKClient() as unknown as MockClient
    const controller = new AbortController()
    const aborted = client.config.fetch('http://local.test/session', { signal: controller.signal })
    const surviving = client.config.fetch('http://local.test/session')

    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })

    resolveFetch(new Response('{}'))
    await expect(surviving).resolves.toBeInstanceOf(Response)
  })
})

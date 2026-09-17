import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./http', () => ({
  getApiBaseUrl: () => 'http://example.test',
  getAuthHeader: () => ({ Authorization: 'Basic test' }),
}))

import { reportPresence } from './presence'

describe('reportPresence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the directories to /global/presence with auth headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(reportPresence(['/one', '/two'])).resolves.toBe(true)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://example.test/global/presence')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Basic test',
    })
    expect(JSON.parse(init.body as string)).toEqual({ directories: ['/one', '/two'] })
  })

  it('skips the request entirely for an empty directory list', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(reportPresence([])).resolves.toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports server rejection as false without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })))

    await expect(reportPresence(['/one'])).resolves.toBe(false)
  })
})

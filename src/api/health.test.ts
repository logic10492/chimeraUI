import { describe, expect, it, vi } from 'vitest'
import { checkCandidateServerHealth, makeBasicAuthHeader } from './health'

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })

describe('candidate server health adapter', () => {
  it('accepts the Chimera global health contract and returns version diagnostics', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ healthy: true, version: '1.2.3' }))

    const result = await checkCandidateServerHealth({ serverUrl: 'http://candidate.test/', fetch })

    expect(result).toMatchObject({ status: 'online', version: '1.2.3' })
    expect(result.details).toContain('Request: GET http://candidate.test/global/health')
    expect(result.details).toContain('Status: 200')
    const request = fetch.mock.calls[0]?.[0] as Request
    expect(request.url).toBe('http://candidate.test/global/health')
    expect(request.method).toBe('GET')
  })

  it.each([
    [new Response('<html>proxy</html>', { headers: { 'content-type': 'text/html' } }), 'Server returned HTML'],
    [jsonResponse({ healthy: false, version: '1.2.3' }), 'Not an OpenCode server'],
    [new Response('{broken', { headers: { 'content-type': 'application/json' } }), 'Invalid OpenCode health JSON'],
  ])('rejects non-health responses with response diagnostics', async (response, error) => {
    const result = await checkCandidateServerHealth({
      serverUrl: 'https://candidate.test/base',
      fetch: vi.fn().mockResolvedValue(response),
    })

    expect(result).toMatchObject({ status: 'error', error: expect.stringContaining(error) })
    expect(result.details).toContain('Body (')
    expect(result.details).toContain('candidate.test/base/global/health')
  })

  it('classifies 401 separately from other HTTP failures', async () => {
    const unauthorized = await checkCandidateServerHealth({
      serverUrl: 'http://candidate.test',
      fetch: vi.fn().mockResolvedValue(jsonResponse({}, { status: 401, statusText: 'Unauthorized' })),
    })
    const unavailable = await checkCandidateServerHealth({
      serverUrl: 'http://candidate.test',
      fetch: vi.fn().mockResolvedValue(new Response('down', { status: 503, statusText: 'Unavailable' })),
    })

    expect(unauthorized).toMatchObject({ status: 'unauthorized', error: 'Invalid credentials' })
    expect(unauthorized.details).toContain('Status: 401 Unauthorized')
    expect(unavailable).toMatchObject({ status: 'error', error: 'HTTP 503' })
    expect(unavailable.details).toContain('Status: 503 Unavailable')
  })

  it('uses explicit candidate URL and auth without reading store state', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ healthy: true, version: 'candidate' }))
    const auth = { username: 'chimera', password: 'secret' }

    await checkCandidateServerHealth({ serverUrl: 'https://other.test/root/', auth, fetch })

    const request = fetch.mock.calls[0]?.[0] as Request
    expect(request.url).toBe('https://other.test/root/global/health')
    expect(request.headers.get('authorization')).toBe(makeBasicAuthHeader(auth))
  })

  it('returns offline diagnostics for network errors', async () => {
    const result = await checkCandidateServerHealth({
      serverUrl: 'http://candidate.test',
      fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    })

    expect(result).toMatchObject({ status: 'offline', error: 'Failed to fetch' })
    expect(result.details).toContain('Error name: TypeError')
    expect(result.details).toContain('Request: GET http://candidate.test/global/health')
  })

  it('aborts and reports a timeout', async () => {
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          })
        }),
    )

    const result = await checkCandidateServerHealth({ serverUrl: 'http://candidate.test', timeoutMs: 1, fetch })

    expect(result).toMatchObject({ status: 'offline', error: 'Connection timed out' })
    expect(result.details).toContain('Error name: AbortError')
  })

  it('redacts sensitive response headers in diagnostics', async () => {
    const result = await checkCandidateServerHealth({
      serverUrl: 'http://candidate.test',
      fetch: vi.fn().mockResolvedValue(
        jsonResponse(
          { healthy: true, version: '1.0.0' },
          {
            headers: {
              'content-type': 'application/json',
              authorization: 'Bearer leaked',
              'x-request-id': 'request-1',
            },
          },
        ),
      ),
    })

    expect(result.details).toContain('"authorization": "<redacted>"')
    expect(result.details).not.toContain('Bearer leaked')
    expect(result.details).toContain('"x-request-id": "request-1"')
  })
})

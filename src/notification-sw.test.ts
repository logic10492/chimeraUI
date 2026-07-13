import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

type WorkerEvent = {
  notification?: { close: () => void; data?: Record<string, unknown> }
  request?: {
    method: string
    headers: { has: (name: string) => boolean }
    mode: string
    url: string
  }
  respondWith?: (response: Promise<unknown>) => void
  waitUntil?: (work: Promise<unknown>) => void
}

function createWorkerHarness() {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const cache = {
    add: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
  }
  const caches = {
    delete: vi.fn(async () => true),
    keys: vi.fn(async () => [] as string[]),
    match: vi.fn(async () => undefined),
    open: vi.fn(async () => cache),
  }
  const clients = {
    matchAll: vi.fn(
      async () =>
        [] as Array<{
          focus: () => Promise<unknown>
          postMessage: (message: unknown) => void
          url: string
        }>,
    ),
    openWindow: vi.fn(async () => undefined),
  }
  const fetch = vi.fn()
  const workerSelf = {
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: 'https://example.test' },
    registration: { scope: 'https://example.test/chimera/' },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener(type: string, listener: (event: WorkerEvent) => void) {
      listeners.set(type, listener)
    },
  }

  vm.runInNewContext(readFileSync(resolve('public/notification-sw.js'), 'utf8'), {
    Request,
    Response,
    URL,
    caches,
    clients,
    encodeURIComponent,
    fetch,
    Promise,
    self: workerSelf,
  })

  return { cache, caches, clients, fetch, listeners }
}

function request(url: string, mode = 'navigate') {
  return {
    method: 'GET',
    headers: { has: () => false },
    mode,
    url,
  }
}

describe('notification service worker', () => {
  it('isolates caches by scope and refreshes only the canonical shell', async () => {
    const harness = createWorkerHarness()
    let installWork: Promise<unknown> | undefined
    harness.listeners.get('install')?.({ waitUntil: work => (installWork = work) })
    await installWork

    expect(harness.caches.open).toHaveBeenCalledWith('chimera-notification-shell-%2Fchimera%2F-v2')
    expect(harness.cache.add).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.test/chimera/' }))

    const response = { clone: vi.fn(() => ({ cached: true })), ok: true, type: 'basic' }
    harness.fetch.mockResolvedValue(response)
    let canonicalResponse: Promise<unknown> | undefined
    harness.listeners.get('fetch')?.({
      request: request('https://example.test/chimera/'),
      respondWith: value => (canonicalResponse = value),
    })
    await canonicalResponse
    await Promise.resolve()
    expect(harness.cache.put).toHaveBeenCalledWith('https://example.test/chimera/', { cached: true })

    harness.cache.put.mockClear()
    let nestedResponse: Promise<unknown> | undefined
    harness.listeners.get('fetch')?.({
      request: request('https://example.test/chimera/settings'),
      respondWith: value => (nestedResponse = value),
    })
    await nestedResponse
    await Promise.resolve()
    expect(harness.cache.put).not.toHaveBeenCalled()
  })

  it('leaves API requests network-only', () => {
    const harness = createWorkerHarness()
    const respondWith = vi.fn()

    harness.listeners.get('fetch')?.({
      request: request('https://example.test/chimera/api/session'),
      respondWith,
    })

    expect(respondWith).not.toHaveBeenCalled()
    expect(harness.fetch).not.toHaveBeenCalled()
  })

  it('focuses only a client inside the worker scope', async () => {
    const harness = createWorkerHarness()
    const wrongClient = {
      focus: vi.fn(async () => undefined),
      postMessage: vi.fn(),
      url: 'https://example.test/other/',
    }
    const scopedClient = {
      focus: vi.fn(async () => undefined),
      postMessage: vi.fn(),
      url: 'https://example.test/chimera/#/session/old',
    }
    harness.clients.matchAll.mockResolvedValue([wrongClient, scopedClient])
    let clickWork: Promise<unknown> | undefined

    harness.listeners.get('notificationclick')?.({
      notification: {
        close: vi.fn(),
        data: { directory: '/tmp/a b', sessionID: 'session/id' },
      },
      waitUntil: work => (clickWork = work),
    })
    await clickWork

    expect(wrongClient.focus).not.toHaveBeenCalled()
    expect(scopedClient.postMessage).toHaveBeenCalledWith({
      type: 'notification-click',
      sessionID: 'session/id',
      directory: '/tmp/a b',
    })
    expect(scopedClient.focus).toHaveBeenCalledOnce()
    expect(harness.clients.openWindow).not.toHaveBeenCalled()
  })
})

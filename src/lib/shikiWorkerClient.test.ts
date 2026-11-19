import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PostedMessage = { type: string; id?: number; key?: string }

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  posted: PostedMessage[] = []
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: PostedMessage) {
    this.posted.push(message)
    if (message.type === 'init') {
      queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } } as MessageEvent))
    }
  }

  terminate() {
    this.terminated = true
  }

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }

  get highlights() {
    return this.posted.filter(message => message.type === 'highlight') as Array<{ id: number; key: string }>
  }
}

function highlightResponse(id: number, key: string, code: string) {
  return {
    type: 'highlight',
    id,
    key,
    code,
    reset: false,
    stable: [['x', '#ffffff']],
    unstable: [],
    html: `<span>${code}</span>`,
  }
}

async function loadClient() {
  vi.resetModules()
  return import('./shikiWorkerClient')
}

async function waitForHighlights(worker: FakeWorker, count: number) {
  await vi.waitFor(() => expect(worker.highlights).toHaveLength(count))
}

function track<T>(promise: Promise<T>) {
  return promise.then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error }),
  )
}

describe('shikiWorkerClient request bookkeeping', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('drops settled keys but keeps supersede detection when same-key requests finish out of order', async () => {
    const client = await loadClient()
    const first = track(
      client.highlightTokensInWorker({ key: 'stream', text: 'a', language: 'text', theme: 'github-dark-default' }),
    )
    const second = track(
      client.highlightTokensInWorker({ key: 'stream', text: 'ab', language: 'text', theme: 'github-dark-default' }),
    )

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    const worker = FakeWorker.instances[0]
    await waitForHighlights(worker, 2)
    expect(client.getShikiWorkerState()).toEqual({ pendingRequests: 2, latestRequestByKey: 1 })

    const [firstRequest, secondRequest] = worker.highlights

    // 新请求先完成：清理 pending 与 key。
    worker.emit(highlightResponse(secondRequest.id, 'stream', 'ab'))
    await expect(second).resolves.toMatchObject({ ok: true })
    expect(client.getShikiWorkerState()).toEqual({ pendingRequests: 1, latestRequestByKey: 0 })

    // 旧请求迟到完成：判定 superseded，且不得复活已清理的 key。
    worker.emit(highlightResponse(firstRequest.id, 'stream', 'a'))
    const firstResult = await first
    expect(firstResult.ok).toBe(false)
    if (!firstResult.ok) expect((firstResult.error as Error).message).toBe('superseded')
    expect(client.getShikiWorkerState()).toEqual({ pendingRequests: 0, latestRequestByKey: 0 })
  })

  it('does not delete another key when a different key completes', async () => {
    const client = await loadClient()
    const alpha = track(client.highlightHtmlInWorker({ key: 'alpha', text: 'a', language: 'text', theme: 'github-dark-default' }))
    const beta = track(
      client.highlightTokensInWorker({ key: 'beta', text: 'b', language: 'text', theme: 'github-dark-default' }),
    )

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    const worker = FakeWorker.instances[0]
    await waitForHighlights(worker, 2)
    expect(client.getShikiWorkerState()).toEqual({ pendingRequests: 2, latestRequestByKey: 2 })

    const [alphaRequest, betaRequest] = worker.highlights
    worker.emit(highlightResponse(alphaRequest.id, 'alpha', 'a'))
    await expect(alpha).resolves.toMatchObject({ ok: true })
    expect(client.getShikiWorkerState()).toEqual({ pendingRequests: 1, latestRequestByKey: 1 })

    worker.emit(highlightResponse(betaRequest.id, 'beta', 'b'))
    await expect(beta).resolves.toMatchObject({ ok: true })
    expect(client.getShikiWorkerState()).toEqual({ pendingRequests: 0, latestRequestByKey: 0 })
  })

  it('clears the key and pending entry after a worker error response rejects the request', async () => {
    const client = await loadClient()
    const request = track(
      client.highlightTokensInWorker({ key: 'broken', text: 'a', language: 'text', theme: 'github-dark-default' }),
    )

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    const worker = FakeWorker.instances[0]
    await waitForHighlights(worker, 1)
    const [message] = worker.highlights
    worker.emit({ type: 'error', id: message.id, key: 'broken', message: 'highlight failed' })

    const result = await request
    expect(result.ok).toBe(false)
    if (!result.ok) expect((result.error as Error).message).toBe('highlight failed')
    expect(client.getShikiWorkerState()).toEqual({ pendingRequests: 0, latestRequestByKey: 0 })
  })

  it('clears pending requests and keys when the worker emits a fatal error', async () => {
    const client = await loadClient()
    const alpha = track(client.highlightTokensInWorker({ key: 'alpha', text: 'a', language: 'text', theme: 'github-dark-default' }))
    const beta = track(client.highlightTokensInWorker({ key: 'beta', text: 'b', language: 'text', theme: 'github-dark-default' }))

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    const worker = FakeWorker.instances[0]
    await waitForHighlights(worker, 2)
    worker.onerror?.(new Error('worker crashed'))

    await expect(alpha).resolves.toMatchObject({ ok: false })
    await expect(beta).resolves.toMatchObject({ ok: false })
    expect(client.getShikiWorkerState()).toEqual({ pendingRequests: 0, latestRequestByKey: 0 })
  })
})
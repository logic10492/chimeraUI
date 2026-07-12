import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notificationStore } from './notificationStore'
import { FollowupQueueStore } from './followupQueueStore'

const key = (serverID: string, directory: string, sessionId: string) =>
  `chimera:followup-queue:v1:${encodeURIComponent(serverID)}:${encodeURIComponent(directory)}:${encodeURIComponent(sessionId)}`

const draft = (serverID: string, directory: string, sessionId: string) => ({
  serverID,
  directory,
  sessionId,
  text: 'follow up',
  attachments: [],
  model: { providerID: 'provider', modelID: 'model' },
})

describe('FollowupQueueStore persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('partitions snapshots by server, directory, and session and restores each server', () => {
    const store = new FollowupQueueStore()
    store.activateServer('server-a')
    const queuedA = store.enqueue(draft('server-a', '/workspace/a', 'session-1'))
    store.markFailed('session-1', queuedA.id)

    store.activateServer('server-b')
    store.enqueue(draft('server-b', '/workspace/b', 'session-1'))
    expect(store.getItems('session-1')[0]?.serverID).toBe('server-b')

    store.activateServer('server-a')
    expect(store.getItems('session-1')).toEqual([
      expect.objectContaining({ id: queuedA.id, directory: '/workspace/a' }),
    ])
    expect(store.getSnapshot().failedBySession['session-1']).toBe(queuedA.id)
    expect(localStorage.getItem(key('server-a', '/workspace/a', 'session-1'))).not.toBeNull()
    expect(localStorage.getItem(key('server-b', '/workspace/b', 'session-1'))).not.toBeNull()
  })

  it('restores a stale sending item as failed without keeping the sending lock', () => {
    const queued = {
      ...draft('server-a', '/workspace/a', 'session-1'),
      id: 'queued_stale',
      createdAt: 1,
    }
    localStorage.setItem(
      key('server-a', '/workspace/a', 'session-1'),
      JSON.stringify({
        version: 1,
        serverID: 'server-a',
        directory: '/workspace/a',
        sessionId: 'session-1',
        items: [queued],
        sendingId: queued.id,
      }),
    )

    const store = new FollowupQueueStore()
    store.activateServer('server-a')

    expect(store.getSnapshot().sendingBySession['session-1']).toBeUndefined()
    expect(store.getSnapshot().failedBySession['session-1']).toBe(queued.id)
  })

  it('keeps in-memory items and shows an error when persistence throws', () => {
    const pushTransient = vi.spyOn(notificationStore, 'pushTransient').mockImplementation(() => {})
    const store = new FollowupQueueStore()
    store.activateServer('server-a')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    const queued = store.enqueue(draft('server-a', '/workspace/a', 'session-1'))

    expect(store.getItems('session-1')[0]?.id).toBe(queued.id)
    expect(pushTransient).toHaveBeenCalledWith(
      'error',
      'Follow-up queue persistence failed',
      expect.stringContaining('quota exceeded'),
    )
  })

  it('activates a safe empty target partition when a snapshot cannot be parsed', () => {
    const pushTransient = vi.spyOn(notificationStore, 'pushTransient').mockImplementation(() => {})
    const store = new FollowupQueueStore()
    store.activateServer('server-a')
    store.enqueue(draft('server-a', '/workspace/a', 'session-1'))
    localStorage.setItem(key('server-b', '/workspace/b', 'session-2'), JSON.stringify({ version: 99 }))

    store.activateServer('server-b')

    expect(store.getItems('session-1')).toEqual([])
    expect(store.getSnapshot()).toEqual({ itemsBySession: {}, failedBySession: {}, sendingBySession: {} })
    const queued = store.enqueue(draft('server-b', '/workspace/b', 'session-2'))
    expect(store.getItems('session-2')[0]?.id).toBe(queued.id)
    expect(localStorage.getItem(key('server-b', '/workspace/b', 'session-2'))).not.toBeNull()
    expect(pushTransient).toHaveBeenCalled()
  })
})

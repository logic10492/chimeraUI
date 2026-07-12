import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LEGACY_KEY = 'opencode:notifications'
const scopedKey = (serverID: string) => `srv:${serverID}:${LEGACY_KEY}`

function notification(title: string) {
  return {
    id: `notification-${title}`,
    type: 'completed' as const,
    title,
    body: `${title} body`,
    sessionId: `session-${title}`,
    timestamp: 1,
    read: false,
  }
}

describe('notificationStore server scoping', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('isolates notification history per server', async () => {
    const { notificationStore } = await import('./notificationStore')

    notificationStore.push('completed', 'Local', 'Local body', 'local-session')
    notificationStore.activateServer('server-a')
    expect(notificationStore.getSnapshot().notifications).toEqual([])

    notificationStore.push('error', 'Remote', 'Remote body', 'remote-session')
    notificationStore.activateServer('local')

    expect(notificationStore.getSnapshot().notifications.map(entry => entry.title)).toEqual(['Local'])
    expect(JSON.parse(localStorage.getItem(scopedKey('server-a')) ?? '[]')).toMatchObject([
      { title: 'Remote', serverID: 'server-a' },
    ])
  })

  it('clears active toasts and their timers when activating another server', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { notificationStore } = await import('./notificationStore')

    notificationStore.push('completed', 'Local', 'Local body', 'local-session')
    const timerCountWithToast = vi.getTimerCount()
    expect(notificationStore.getSnapshot().toasts).toHaveLength(1)

    notificationStore.activateServer('server-a')

    expect(notificationStore.getSnapshot().toasts).toEqual([])
    expect(vi.getTimerCount()).toBe(timerCountWithToast - 1)
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })

  it('migrates legacy notification history once to the active server key', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([notification('Legacy')]))

    const firstModule = await import('./notificationStore')

    expect(firstModule.notificationStore.getSnapshot().notifications).toMatchObject([
      { title: 'Legacy', serverID: 'local' },
    ])
    expect(JSON.parse(localStorage.getItem(scopedKey('local')) ?? '[]')).toMatchObject([
      { title: 'Legacy', serverID: 'local' },
    ])

    localStorage.setItem(LEGACY_KEY, JSON.stringify([notification('Changed legacy')]))
    vi.resetModules()
    const secondModule = await import('./notificationStore')

    expect(secondModule.notificationStore.getSnapshot().notifications).toMatchObject([
      { title: 'Legacy', serverID: 'local' },
    ])
    secondModule.notificationStore.activateServer('server-a')
    expect(secondModule.notificationStore.getSnapshot().notifications).toEqual([])
  })
})

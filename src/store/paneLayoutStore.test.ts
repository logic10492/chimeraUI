import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notificationStore } from './notificationStore'
import { paneLayoutStore } from './paneLayoutStore'

const key = (serverID: string) => `chimera:pane-layout:v1:${encodeURIComponent(serverID)}`

describe('paneLayoutStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    paneLayoutStore.activateServer('test-default')
  })

  it('focuses the sibling subtree when closing the focused pane', () => {
    paneLayoutStore.reset()
    paneLayoutStore.setFocusedSession('session-a')
    const paneB = paneLayoutStore.splitPane('pane-1', 'horizontal', 'session-b')
    expect(paneB).toBe('pane-2')
    const paneC = paneLayoutStore.splitPane('pane-2', 'vertical', 'session-c')
    expect(paneC).toBe('pane-3')

    paneLayoutStore.focusPane('pane-3')
    paneLayoutStore.closePane('pane-3')

    expect(paneLayoutStore.getFocusedPaneId()).toBe('pane-2')
    expect(paneLayoutStore.getFocusedSessionId()).toBe('session-b')
  })

  it('restores independent layout trees and ratios per server', () => {
    paneLayoutStore.activateServer('server-a')
    paneLayoutStore.setFocusedSession('session-a')
    paneLayoutStore.splitPane('pane-1', 'horizontal', 'session-b')
    const splitA = paneLayoutStore.getRoot()
    expect(splitA.type).toBe('split')
    if (splitA.type !== 'split') return
    paneLayoutStore.setRatio(splitA.id, 0.7)
    paneLayoutStore.focusPane('pane-1')

    paneLayoutStore.activateServer('server-b')
    expect(paneLayoutStore.getSnapshot().paneCount).toBe(1)
    paneLayoutStore.setFocusedSession('session-c')

    paneLayoutStore.activateServer('server-a')
    const restored = paneLayoutStore.getRoot()
    expect(restored.type).toBe('split')
    if (restored.type !== 'split') return
    expect(restored.ratio).toBe(0.7)
    expect(paneLayoutStore.getFocusedPaneId()).toBe('pane-1')
    expect(paneLayoutStore.allLeaves().map(leaf => leaf.sessionId)).toEqual(['session-a', 'session-b'])
    expect(localStorage.getItem(key('server-b'))).not.toBeNull()
    expect(paneLayoutStore.splitPane('pane-2', 'vertical', 'session-d')).toBe('pane-3')
  })

  it('falls back to a safe single pane for invalid node ids, ratios, and bindings', () => {
    const pushTransient = vi.spyOn(notificationStore, 'pushTransient').mockImplementation(() => {})
    localStorage.setItem(
      key('invalid-server'),
      JSON.stringify({
        version: 1,
        serverID: 'invalid-server',
        root: {
          type: 'split',
          id: 'duplicate',
          direction: 'horizontal',
          ratio: 2,
          first: { type: 'leaf', id: 'duplicate', sessionId: 'a' },
          second: { type: 'leaf', id: 'pane-b', sessionId: 'b' },
        },
        focusedPaneId: 'missing',
        fullscreenPaneId: 'missing',
      }),
    )

    paneLayoutStore.activateServer('invalid-server')

    expect(paneLayoutStore.getRoot()).toMatchObject({ type: 'leaf', sessionId: null })
    expect(paneLayoutStore.getSnapshot().paneCount).toBe(1)
    expect(pushTransient).toHaveBeenCalled()
  })

  it('uses a safe empty target partition on parse and version errors', () => {
    const pushTransient = vi.spyOn(notificationStore, 'pushTransient').mockImplementation(() => {})
    paneLayoutStore.activateServer('server-a')
    paneLayoutStore.setFocusedSession('session-a')
    localStorage.setItem(key('server-b'), '{bad json')

    paneLayoutStore.activateServer('server-b')

    expect(paneLayoutStore.getFocusedSessionId()).toBeNull()
    expect(paneLayoutStore.getSnapshot().paneCount).toBe(1)
    expect(localStorage.getItem(key('server-b'))).not.toBeNull()
    expect(pushTransient).toHaveBeenCalled()
  })

  it('keeps in-memory layout when quota failures prevent persistence', () => {
    const pushTransient = vi.spyOn(notificationStore, 'pushTransient').mockImplementation(() => {})
    paneLayoutStore.activateServer('server-a')
    paneLayoutStore.setFocusedSession('session-a')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    paneLayoutStore.setFocusedSession('session-after-quota')

    expect(paneLayoutStore.getFocusedSessionId()).toBe('session-after-quota')
    expect(pushTransient).toHaveBeenCalled()
  })
})

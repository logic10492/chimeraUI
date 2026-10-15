import { beforeEach, describe, expect, it } from 'vitest'
import { activeSessionStore } from './activeSessionStore'
import { childSessionStore } from './childSessionStore'
import type { ApiSession } from '../api/types'

describe('activeSessionStore scoped refresh handling', () => {
  beforeEach(() => {
    activeSessionStore.initialize({})
    activeSessionStore.initializePendingRequests([], [])
    for (const sessionId of ['scoped', 'shared', 'moving']) {
      activeSessionStore.removeSession(sessionId, 'server-a')
      activeSessionStore.removeSession(sessionId, 'server-b')
    }
  })

  it('preserves existing busy child sessions when merging scoped status refreshes', () => {
    activeSessionStore.initialize({
      root: { type: 'busy' },
      child: { type: 'busy' },
    })

    activeSessionStore.mergeStatusRefresh({
      root: { type: 'busy' },
    })

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['root', 'child'])
  })

  it('drops missing sessions on full status replacement refreshes', () => {
    activeSessionStore.initialize({
      root: { type: 'busy' },
      child: { type: 'busy' },
    })

    activeSessionStore.initialize({
      root: { type: 'busy' },
    })

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['root'])
  })

  it('keeps existing pending child requests during scoped pending refresh merges', () => {
    activeSessionStore.addPendingRequest('req-child', 'child', 'question', 'Need approval')

    activeSessionStore.mergePendingRequests([], [])

    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['child'])
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'question',
      description: 'Need approval',
    })
  })

  it('preserves server and workspace metadata for target-session routing', () => {
    activeSessionStore.setSessionMeta('scoped', 'Scoped', '/workspace', 'server-a', 'workspace-a')

    expect(activeSessionStore.getSessionMeta('scoped', 'server-a')).toEqual({
      title: 'Scoped',
      directory: '/workspace',
      serverID: 'server-a',
      workspaceID: 'workspace-a',
    })
  })

  it('isolates identical session IDs by server', () => {
    activeSessionStore.setSessionMeta('shared', 'Server A', '/same', 'server-a', 'workspace-a')
    activeSessionStore.setSessionMeta('shared', 'Server B', '/same', 'server-b', 'workspace-b')

    expect(activeSessionStore.getSessionMeta('shared', 'server-a')).toMatchObject({
      title: 'Server A',
      serverID: 'server-a',
      workspaceID: 'workspace-a',
    })
    expect(activeSessionStore.getSessionMeta('shared', 'server-b')).toMatchObject({
      title: 'Server B',
      serverID: 'server-b',
      workspaceID: 'workspace-b',
    })
    expect(activeSessionStore.getSessionMeta('shared')).toBeUndefined()
    expect(activeSessionStore.getSessionMetaServerIDs('shared').sort()).toEqual(['server-a', 'server-b'])
  })

  it('clears stale workspace routing when a scoped session returns to directory routing', () => {
    activeSessionStore.setSessionMeta('moving', 'Moving', '/old', 'server-a', 'workspace-a')
    activeSessionStore.setSessionMeta('moving', 'Moving', '/new', 'server-a', undefined)

    expect(activeSessionStore.getSessionMeta('moving', 'server-a')).toEqual({
      title: 'Moving',
      directory: '/new',
      serverID: 'server-a',
      workspaceID: undefined,
    })
  })

  describe('activeSessionStore server-scoped runtime state', () => {
    beforeEach(() => {
      activeSessionStore.resetRuntimeState()
      for (const sessionId of ['server-only', 'directory-a', 'directory-b', 'workspace-a', 'workspace-b']) {
        activeSessionStore.removeSession(sessionId, 'server-a')
        activeSessionStore.removeSession(sessionId, 'server-b')
      }
    })

    it('resets runtime status and pending requests while preserving session metadata', () => {
      activeSessionStore.setSessionMeta('server-only', 'Server only', '/project', 'server-a')
      activeSessionStore.initialize({ 'server-only': { type: 'busy' } })
      activeSessionStore.addPendingRequest('request-1', 'pending-session', 'question', 'Continue?')

      activeSessionStore.resetRuntimeState()

      expect(activeSessionStore.getSnapshot()).toEqual({ statusMap: {}, initialized: false })
      expect(activeSessionStore.getBusySessions()).toEqual([])
      expect(activeSessionStore.getSessionMeta('server-only', 'server-a')).toMatchObject({
        title: 'Server only',
        directory: '/project',
      })

      activeSessionStore.resolvePendingRequest('request-1')
      expect(activeSessionStore.getSnapshot().statusMap).toEqual({})
    })

    it('returns session IDs for server, directory, and workspace scopes', () => {
      activeSessionStore.setSessionMeta('server-only', 'Server only', '/root', 'server-a')
      activeSessionStore.setSessionMeta('directory-a', 'Directory A', '/project-a', 'server-a')
      activeSessionStore.setSessionMeta('directory-b', 'Directory B', '/project-b', 'server-a')
      activeSessionStore.setSessionMeta('workspace-a', 'Workspace A', '/shared', 'server-a', 'workspace-a')
      activeSessionStore.setSessionMeta('workspace-b', 'Workspace B', '/shared', 'server-a', 'workspace-b')
      activeSessionStore.setSessionMeta('server-only', 'Other server', '/root', 'server-b')

      expect(activeSessionStore.getSessionIdsForScope({ serverID: 'server-a' }).sort()).toEqual([
        'directory-a',
        'directory-b',
        'server-only',
        'workspace-a',
        'workspace-b',
      ])
      expect(activeSessionStore.getSessionIdsForScope({ serverID: 'server-a', directory: '/project-a' })).toEqual([
        'directory-a',
      ])
      expect(
        activeSessionStore.getSessionIdsForScope({
          serverID: 'server-a',
          directory: '/ignored-when-workspace-is-present',
          workspace: 'workspace-b',
        }),
      ).toEqual(['workspace-b'])
      expect(activeSessionStore.getSessionIdsForScope({ serverID: 'server-b' })).toEqual(['server-only'])
    })
  })
  it('reuses the busySessions array reference when content is unchanged', () => {
    activeSessionStore.initialize({
      root: { type: 'busy' },
    })
    activeSessionStore.setSessionMeta('root', 'Root', '/repo')

    const first = activeSessionStore.getBusySessionsSnapshot()
    activeSessionStore.mergeStatusRefresh({
      root: { type: 'busy' },
    })
    const second = activeSessionStore.getBusySessionsSnapshot()

    expect(second).toBe(first)
    expect(second).toEqual([
      {
        sessionId: 'root',
        status: { type: 'busy' },
        title: 'Root',
        directory: '/repo',
        serverID: 'local',
        workspaceID: undefined,
        pendingAction: undefined,
      },
    ])
  })

  it('replaces the busySessions array reference when status content changes', () => {
    activeSessionStore.initialize({
      root: { type: 'busy' },
    })
    const first = activeSessionStore.getBusySessionsSnapshot()

    activeSessionStore.updateStatus('root', {
      type: 'retry',
      attempt: 1,
      message: 'retrying',
      next: 1000,
    })
    const second = activeSessionStore.getBusySessionsSnapshot()

    expect(second).not.toBe(first)
    expect(second[0]?.status).toEqual({
      type: 'retry',
      attempt: 1,
      message: 'retrying',
      next: 1000,
    })
  })
})

describe('activeSessionStore retained (待查看留存)', () => {
  beforeEach(() => {
    activeSessionStore.resetRuntimeState()
  })

  const retainedIds = () => activeSessionStore.getRetainedSessionsSnapshot().map(entry => entry.sessionId)

  it('retains a session that transitions busy→idle via updateStatus', () => {
    activeSessionStore.initialize({ task: { type: 'busy' } })
    activeSessionStore.updateStatus('task', { type: 'idle' })

    expect(activeSessionStore.getBusySessions()).toEqual([])
    expect(activeSessionStore.getRetainedSessionsSnapshot()).toEqual([
      expect.objectContaining({ sessionId: 'task', status: { type: 'idle' }, retainedViewed: false }),
    ])
  })

  it('drops retention after markRetainedViewed + releaseRetained', () => {
    activeSessionStore.initialize({ task: { type: 'busy' } })
    activeSessionStore.updateStatus('task', { type: 'idle' })

    activeSessionStore.markRetainedViewed('task')
    expect(activeSessionStore.getRetainedSessionsSnapshot()[0]?.retainedViewed).toBe(true)

    activeSessionStore.releaseRetained('task')
    expect(retainedIds()).toEqual([])
  })

  it('clears retention when the session becomes busy or retry again', () => {
    activeSessionStore.initialize({ task: { type: 'busy' } })
    activeSessionStore.updateStatus('task', { type: 'idle' })
    expect(retainedIds()).toEqual(['task'])

    activeSessionStore.updateStatus('task', { type: 'busy' })
    expect(retainedIds()).toEqual([])
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['task'])

    activeSessionStore.updateStatus('task', { type: 'idle' })
    activeSessionStore.updateStatus('task', { type: 'retry', attempt: 1, message: 'retrying', next: 1000 })
    expect(retainedIds()).toEqual([])
    expect(activeSessionStore.getBusySessions().map(entry => entry.sessionId)).toEqual(['task'])
  })

  it('clears retention when a pending request arrives and retains again after resolve', () => {
    activeSessionStore.initialize({ task: { type: 'busy' } })
    activeSessionStore.updateStatus('task', { type: 'idle' })
    expect(retainedIds()).toEqual(['task'])

    activeSessionStore.addPendingRequest('req-1', 'task', 'question', 'Continue?')
    expect(retainedIds()).toEqual([])
    expect(activeSessionStore.getBusySessions()[0]?.pendingAction).toEqual({
      type: 'question',
      description: 'Continue?',
    })

    activeSessionStore.resolvePendingRequest('req-1')
    // deferred busy 结束后同样进入待查看留存
    expect(retainedIds()).toEqual(['task'])
  })

  it('does not retain sessions already idle at initialize time', () => {
    activeSessionStore.initialize({ fresh: { type: 'idle' } })

    expect(retainedIds()).toEqual([])
  })

  it('retains a busy session turned idle by mergeStatusRefresh', () => {
    activeSessionStore.initialize({ task: { type: 'busy' } })
    activeSessionStore.mergeStatusRefresh({ task: { type: 'idle' } })

    expect(retainedIds()).toEqual(['task'])
  })

  it('clears retention on removeSession and resetRuntimeState', () => {
    activeSessionStore.initialize({ a: { type: 'busy' }, b: { type: 'busy' } })
    activeSessionStore.updateStatus('a', { type: 'idle' })
    activeSessionStore.updateStatus('b', { type: 'idle' })
    expect(retainedIds().sort()).toEqual(['a', 'b'])

    activeSessionStore.removeSession('a')
    expect(retainedIds()).toEqual(['b'])

    activeSessionStore.resetRuntimeState()
    expect(retainedIds()).toEqual([])
  })

  it('reuses the retained array reference when content is unchanged', () => {
    activeSessionStore.initialize({ task: { type: 'busy' } })
    activeSessionStore.updateStatus('task', { type: 'idle' })
    const first = activeSessionStore.getRetainedSessionsSnapshot()

    activeSessionStore.setSessionMeta('other', 'Other', '/repo')
    const second = activeSessionStore.getRetainedSessionsSnapshot()

    expect(second).toBe(first)
  })
})

describe('activeSessionStore 后台子会话活跃合成 (backgroundBusy)', () => {
  const makeChild = (id: string, parentID: string): ApiSession =>
    ({ id, parentID, title: id, time: { created: Date.now() } }) as unknown as ApiSession

  const busyIds = () => activeSessionStore.getBusySessions().map(entry => entry.sessionId)
  const retainedIds = () => activeSessionStore.getRetainedSessionsSnapshot().map(entry => entry.sessionId)

  beforeEach(() => {
    childSessionStore.clearAll()
    activeSessionStore.resetRuntimeState()
  })

  it('synthesizes an idle parent as backgroundBusy while a child session is running', () => {
    activeSessionStore.initialize({})
    childSessionStore.registerChildSession(makeChild('child', 'root'))
    activeSessionStore.reconcileChildSessions()

    expect(activeSessionStore.getBusySessions()).toEqual([
      expect.objectContaining({ sessionId: 'child', status: { type: 'busy' } }),
      expect.objectContaining({ sessionId: 'root', status: { type: 'idle' }, backgroundBusy: true }),
    ])
  })

  it('drops the backgroundBusy parent when the last child goes idle and retains a previously busy parent', () => {
    activeSessionStore.initialize({ root: { type: 'busy' } })
    childSessionStore.registerChildSession(makeChild('child', 'root'))
    activeSessionStore.reconcileChildSessions()
    expect(busyIds().sort()).toEqual(['child', 'root'])

    // root 自身 idle：仍有 running 后代 → 不进留存，继续以 backgroundBusy 留在活跃区
    activeSessionStore.updateStatus('root', { type: 'idle' })
    expect(retainedIds()).toEqual([])
    expect(activeSessionStore.getBusySessions().find(entry => entry.sessionId === 'root')).toMatchObject({
      status: { type: 'idle' },
      backgroundBusy: true,
    })

    // 最后一个后代 idle → backgroundBusy 条目消失，补入待查看留存
    childSessionStore.markIdle('child')
    activeSessionStore.reconcileChildSessions()
    expect(busyIds()).toEqual([])
    expect(activeSessionStore.getRetainedSessionsSnapshot()).toEqual([
      expect.objectContaining({ sessionId: 'root', status: { type: 'idle' }, retainedViewed: false }),
    ])
  })

  it('does not duplicate a parent that is busy itself while a child is running', () => {
    activeSessionStore.initialize({ root: { type: 'busy' } })
    childSessionStore.registerChildSession(makeChild('child', 'root'))
    activeSessionStore.reconcileChildSessions()

    expect(busyIds().sort()).toEqual(['child', 'root'])
    const rootEntries = activeSessionStore.getBusySessions().filter(entry => entry.sessionId === 'root')
    expect(rootEntries).toHaveLength(1)
    expect(rootEntries[0]).toMatchObject({ status: { type: 'busy' } })
    expect(rootEntries[0]?.backgroundBusy).toBeUndefined()
  })

  it('synthesizes the whole ancestor chain for a running grandchild', () => {
    activeSessionStore.initialize({})
    childSessionStore.registerChildSession(makeChild('parent', 'grandparent'))
    childSessionStore.registerChildSession(makeChild('child', 'parent'))
    // parent 自身已 idle，只剩 grandchild 在跑
    childSessionStore.markIdle('parent')
    activeSessionStore.reconcileChildSessions()

    const byId = new Map(activeSessionStore.getBusySessions().map(entry => [entry.sessionId, entry]))
    expect(byId.get('child')).toMatchObject({ status: { type: 'busy' } })
    expect(byId.get('parent')).toMatchObject({ status: { type: 'idle' }, backgroundBusy: true })
    expect(byId.get('grandparent')).toMatchObject({ status: { type: 'idle' }, backgroundBusy: true })
  })

  it('keeps the synthesized child entry when the child also reports busy via statusMap', () => {
    activeSessionStore.initialize({})
    childSessionStore.registerChildSession(makeChild('child', 'root'))
    activeSessionStore.updateStatus('child', { type: 'busy' })

    const childEntries = activeSessionStore.getBusySessions().filter(entry => entry.sessionId === 'child')
    expect(childEntries).toHaveLength(1)
    expect(childEntries[0]?.backgroundBusy).toBeUndefined()
    expect(busyIds().sort()).toEqual(['child', 'root'])
  })

  it('clears retention when a retained parent becomes busy again while a child is running', () => {
    activeSessionStore.initialize({ root: { type: 'busy' } })
    activeSessionStore.updateStatus('root', { type: 'idle' })
    expect(retainedIds()).toEqual(['root'])

    childSessionStore.registerChildSession(makeChild('child', 'root'))
    activeSessionStore.reconcileChildSessions()
    activeSessionStore.updateStatus('root', { type: 'busy' })

    expect(retainedIds()).toEqual([])
    expect(busyIds().sort()).toEqual(['child', 'root'])
  })

  it('clears waitRetain on resetRuntimeState so the parent is never retained afterwards', () => {
    activeSessionStore.initialize({ root: { type: 'busy' } })
    childSessionStore.registerChildSession(makeChild('child', 'root'))
    activeSessionStore.reconcileChildSessions()
    activeSessionStore.updateStatus('root', { type: 'idle' })
    expect(retainedIds()).toEqual([])

    childSessionStore.clearAll()
    activeSessionStore.resetRuntimeState()

    expect(retainedIds()).toEqual([])
    expect(activeSessionStore.getBusySessions()).toEqual([])
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { activeSessionStore } from './activeSessionStore'

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
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSession } from '../api/types'

const { getSessionChildrenMock } = vi.hoisted(() => ({
  getSessionChildrenMock: vi.fn<(sessionId: string, directory?: string) => Promise<ApiSession[]>>(),
}))

vi.mock('../api/session', () => ({
  getSessionChildren: (...args: [string, string?]) => getSessionChildrenMock(...args),
}))

import { clearSingleFlight } from '../api/singleFlight'
import { childSessionStore } from './childSessionStore'

function makeChildSession(id: string, parentID: string, directory = '/workspace/demo'): ApiSession {
  return {
    id,
    slug: id,
    projectID: 'project-1',
    directory,
    parentID,
    title: `Child ${id}`,
    version: '1',
    time: { created: 1, updated: 2 },
  }
}

describe('childSessionStore fetched children cache', () => {
  beforeEach(() => {
    childSessionStore.clearAll()
    clearSingleFlight()
    getSessionChildrenMock.mockReset()
  })

  it('cold load fetches once and hydrates; hot load hits the cache with 0 requests', async () => {
    const children = [makeChildSession('child-1', 'parent-1'), makeChildSession('child-2', 'parent-1')]
    getSessionChildrenMock.mockResolvedValue(children)

    const first = await childSessionStore.loadChildren('parent-1', '/workspace/demo')

    expect(getSessionChildrenMock).toHaveBeenCalledTimes(1)
    expect(getSessionChildrenMock).toHaveBeenCalledWith('parent-1', '/workspace/demo')
    expect(first).toEqual(children)
    expect(childSessionStore.hasCachedChildSessions('parent-1', '/workspace/demo')).toBe(true)

    // 热切：缓存命中，0 次 /children 请求（W3① DoD）
    const second = await childSessionStore.loadChildren('parent-1', '/workspace/demo')
    expect(second).toBe(first)
    expect(getSessionChildrenMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes directory styles so both consumer paths share one cache entry', async () => {
    getSessionChildrenMock.mockResolvedValue([makeChildSession('child-1', 'parent-1')])

    await childSessionStore.loadChildren('parent-1', 'E:\\Dev\\Demo')
    await childSessionStore.loadChildren('parent-1', 'e:/dev/demo/')

    expect(getSessionChildrenMock).toHaveBeenCalledTimes(1)
    expect(childSessionStore.hasCachedChildSessions('parent-1', 'E:/dev/demo')).toBe(true)
  })

  it('shares one in-flight request between concurrent loaders (sidebar + message area)', async () => {
    let resolveChildren!: (value: ApiSession[]) => void
    getSessionChildrenMock.mockImplementation(
      () =>
        new Promise<ApiSession[]>(resolve => {
          resolveChildren = resolve
        }),
    )

    const first = childSessionStore.loadChildren('parent-1', '/workspace/demo')
    const second = childSessionStore.loadChildren('parent-1', '/workspace/demo')
    expect(getSessionChildrenMock).toHaveBeenCalledTimes(1)

    const children = [makeChildSession('child-1', 'parent-1')]
    resolveChildren(children)

    await expect(first).resolves.toBe(children)
    await expect(second).resolves.toBe(children)
  })

  it('appends created children and patches updated children without refetching', async () => {
    getSessionChildrenMock.mockResolvedValue([makeChildSession('child-1', 'parent-1')])
    await childSessionStore.loadChildren('parent-1', '/workspace/demo')

    childSessionStore.appendCachedChildSession(makeChildSession('child-2', 'parent-1'))
    // 重复追加幂等
    childSessionStore.appendCachedChildSession(makeChildSession('child-2', 'parent-1'))
    expect(childSessionStore.getCachedChildSessions('parent-1', '/workspace/demo')?.map(s => s.id)).toEqual([
      'child-1',
      'child-2',
    ])

    childSessionStore.patchCachedChildSession({ ...makeChildSession('child-1', 'parent-1'), title: 'Renamed' })
    expect(childSessionStore.getCachedChildSessions('parent-1', '/workspace/demo')?.[0].title).toBe('Renamed')

    expect(getSessionChildrenMock).toHaveBeenCalledTimes(1)
  })

  it('drops deleted children from cached lists and removes lists they parent', async () => {
    getSessionChildrenMock
      .mockResolvedValueOnce([makeChildSession('child-1', 'parent-1')])
      .mockResolvedValueOnce([makeChildSession('grandchild-1', 'child-1')])
    await childSessionStore.loadChildren('parent-1', '/workspace/demo')
    await childSessionStore.loadChildren('child-1', '/workspace/demo')

    childSessionStore.removeCachedChildSession('child-1')

    expect(childSessionStore.getCachedChildSessions('parent-1', '/workspace/demo')).toEqual([])
    expect(childSessionStore.hasCachedChildSessions('child-1', '/workspace/demo')).toBe(false)
  })

  it('purges the cache through removeSession when a session subtree is deleted', async () => {
    getSessionChildrenMock.mockResolvedValue([makeChildSession('child-1', 'parent-1')])
    await childSessionStore.loadChildren('parent-1', '/workspace/demo')

    childSessionStore.registerChildSession(makeChildSession('child-1', 'parent-1'))
    childSessionStore.removeSession('child-1')

    expect(childSessionStore.getCachedChildSessions('parent-1', '/workspace/demo')).toEqual([])
  })

  it('clearAll wipes the fetched cache (server switch)', async () => {
    getSessionChildrenMock.mockResolvedValue([makeChildSession('child-1', 'parent-1')])
    await childSessionStore.loadChildren('parent-1', '/workspace/demo')

    childSessionStore.clearAll()

    expect(childSessionStore.hasCachedChildSessions('parent-1', '/workspace/demo')).toBe(false)
  })

  it('force reload bypasses the cache and refreshes it', async () => {
    getSessionChildrenMock
      .mockResolvedValueOnce([makeChildSession('child-1', 'parent-1')])
      .mockResolvedValueOnce([makeChildSession('child-1', 'parent-1'), makeChildSession('child-2', 'parent-1')])
    await childSessionStore.loadChildren('parent-1', '/workspace/demo')

    const forced = await childSessionStore.loadChildren('parent-1', '/workspace/demo', { force: true })

    expect(getSessionChildrenMock).toHaveBeenCalledTimes(2)
    expect(forced.map(s => s.id)).toEqual(['child-1', 'child-2'])
    expect(childSessionStore.getCachedChildSessions('parent-1', '/workspace/demo')).toBe(forced)
  })
})

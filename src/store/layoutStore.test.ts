import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LayoutStore } from './layoutStore'

const STORAGE_KEY_PANEL_LAYOUT = 'opencode-panel-layout'
const SCOPE_A = '["server-a","workspace","workspace-a"]'
const SCOPE_B = '["server-b","workspace","workspace-b"]'
const terminalStorageKey = (scopeKey: string, ptyId: string) => `${scopeKey}\u0000${ptyId}`

describe('LayoutStore panel and terminal layout', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('persists global panel layout without persisting terminal tabs', () => {
    const store = new LayoutStore()

    store.addMcpTab('bottom')
    store.addGraphTab('right')
    store.addTerminalTab({ id: 'term-1', title: 'Terminal 1', status: 'connected' }, true, 'right')
    store.openRightPanel('changes')

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY_PANEL_LAYOUT) ?? 'null')

    expect(persisted).toMatchObject({
      version: 1,
      rightPanelOpen: true,
      bottomPanelOpen: true,
    })
    expect(persisted.panelTabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'files', type: 'files', position: 'right' }),
        expect.objectContaining({ id: 'changes', type: 'changes', position: 'right' }),
        expect.objectContaining({ id: 'mcp', type: 'mcp', position: 'bottom' }),
        expect.objectContaining({ id: 'graph', type: 'graph', position: 'right' }),
      ]),
    )
    expect(persisted.panelTabs.some((tab: { id: string }) => tab.id === 'term-1')).toBe(false)

    const restored = new LayoutStore().getState()
    expect(restored.rightPanelOpen).toBe(true)
    expect(restored.bottomPanelOpen).toBe(true)
    expect(restored.panelTabs.some(tab => tab.id === 'mcp' && tab.position === 'bottom')).toBe(true)
    expect(restored.panelTabs.some(tab => tab.id === 'term-1')).toBe(false)
  })

  it('persists one graph tab and moves it between panels instead of duplicating it', () => {
    const store = new LayoutStore()

    expect(store.addGraphTab('right')).toBe('graph')
    expect(store.addGraphTab('bottom')).toBe('graph')

    const graphTabs = store.getState().panelTabs.filter(tab => tab.type === 'graph')
    expect(graphTabs).toEqual([expect.objectContaining({ id: 'graph', position: 'bottom' })])
    expect(store.getState().activeTabId.bottom).toBe('graph')

    const restored = new LayoutStore().getState()
    expect(restored.panelTabs.filter(tab => tab.type === 'graph')).toEqual([
      expect.objectContaining({ id: 'graph', position: 'bottom' }),
    ])
  })

  it.each([
    { position: 'right' as const, activateAnotherTab: (store: LayoutStore) => store.addStatusTab('right') },
    { position: 'bottom' as const, activateAnotherTab: (store: LayoutStore) => store.addMcpTab('bottom') },
  ])(
    're-adding Graph activates it and reopens a collapsed $position panel without duplication',
    ({ position, activateAnotherTab }) => {
      const store = new LayoutStore()

      store.addGraphTab(position)
      activateAnotherTab(store)
      if (position === 'right') store.closeRightPanel()
      else store.closeBottomPanel()

      expect(store.addGraphTab(position)).toBe('graph')

      const state = store.getState()
      expect(state.panelTabs.filter(tab => tab.type === 'graph')).toEqual([
        expect.objectContaining({ id: 'graph', position }),
      ])
      expect(state.activeTabId[position]).toBe('graph')
      expect(position === 'right' ? state.rightPanelOpen : state.bottomPanelOpen).toBe(true)
    },
  )

  it('keeps bottom and right panels open when syncing a directory with no terminal sessions', () => {
    const store = new LayoutStore()

    store.openBottomPanel()
    store.openRightPanel('files')
    store.syncTerminalSessions('dir-a', [])

    expect(store.getState().bottomPanelOpen).toBe(true)
    expect(store.getState().rightPanelOpen).toBe(true)
    expect(store.getTerminalTabs('bottom')).toEqual([])
    expect(store.getTerminalTabs('right')).toEqual([])
  })

  it('restores terminal positions for each directory when switching between projects', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [
      { id: 'term-a1', title: 'A1', status: 'connected' },
      { id: 'term-a2', title: 'A2', status: 'connected' },
    ])
    store.moveTab('term-a2', 'right')

    store.syncTerminalSessions('dir-b', [{ id: 'term-b1', title: 'B1', status: 'connected' }])
    store.syncTerminalSessions('dir-a', [
      { id: 'term-a1', title: 'A1', status: 'connected' },
      { id: 'term-a2', title: 'A2', status: 'connected' },
    ])

    expect(store.getTerminalTabs('bottom').map(tab => tab.id)).toEqual(['term-a1'])
    expect(store.getTerminalTabs('right').map(tab => tab.id)).toEqual(['term-a2'])
  })

  it('removes project terminal tabs when syncing global terminal sessions', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    store.syncTerminalSessions(undefined, [])

    expect(store.getTerminalTabs('bottom')).toEqual([])
    expect(store.getState().panelTabs.some(tab => tab.id === 'term-a1')).toBe(false)
  })

  it('does not notify when a terminal snapshot is unchanged', () => {
    const store = new LayoutStore()
    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    const snapshot = { buffer: 'pwd\r\n/workspace\r\n', scrollY: 2, cursor: 18, rows: 24, cols: 80 }

    store.updateTerminalSnapshot('term-a1', snapshot)
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    store.updateTerminalSnapshot('term-a1', snapshot)

    unsubscribe()
    expect(notifications).toBe(0)
  })

  it('falls back to status when a stale terminal active id disappears after sync', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    store.moveTab('term-a1', 'right')
    store.setActiveTab('right', 'term-a1')

    store.syncTerminalSessions('dir-b', [])

    expect(store.getState().activeTabId.right).toBe('status')
  })

  it('persists terminal snapshots and restores them on the next sync', () => {
    const store = new LayoutStore()

    store.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])
    store.updateTerminalSnapshot('term-a1', {
      buffer: 'pwd\r\n/workspace\r\n',
      scrollY: 2,
      cursor: 18,
      rows: 24,
      cols: 80,
    })

    const persisted = JSON.parse(localStorage.getItem('opencode-terminal-layout') ?? 'null')
    expect(persisted.directories['dir-a'].sessions['term-a1']).toMatchObject({
      buffer: 'pwd\r\n/workspace\r\n',
      scrollY: 2,
      cursor: 18,
      rows: 24,
      cols: 80,
    })

    const restored = new LayoutStore()
    restored.syncTerminalSessions('dir-a', [{ id: 'term-a1', title: 'A1', status: 'connected' }])

    expect(restored.getState().panelTabs.find(tab => tab.id === 'term-a1')).toMatchObject({
      buffer: 'pwd\r\n/workspace\r\n',
      scrollY: 2,
      cursor: 18,
      rows: 24,
      cols: 80,
    })
  })

  it('isolates terminal layout and snapshots when PTY IDs collide across scopes', () => {
    const store = new LayoutStore()
    const snapshotA = { buffer: 'scope-a', scrollY: 1, cursor: 7, rows: 24, cols: 80 }
    const snapshotB = { buffer: 'scope-b', scrollY: 2, cursor: 8, rows: 30, cols: 100 }

    store.syncTerminalSessions('/same', [{ id: 'shared', scopeKey: SCOPE_A, title: 'A', status: 'connected' }], SCOPE_A)
    store.updateTerminalSnapshot('shared', snapshotA, SCOPE_A)
    store.moveTab('shared', 'right')

    store.syncTerminalSessions('/same', [{ id: 'shared', scopeKey: SCOPE_B, title: 'B', status: 'connected' }], SCOPE_B)
    expect(store.getTerminalTabs('bottom')).toEqual([expect.objectContaining({ id: 'shared', scopeKey: SCOPE_B })])
    expect(store.getTerminalTabs('right')).toEqual([])
    expect(store.getState().panelTabs.find(tab => tab.type === 'terminal')?.buffer).toBeUndefined()

    store.updateTerminalSnapshot('shared', snapshotA, SCOPE_A)
    expect(store.getState().panelTabs.find(tab => tab.type === 'terminal')?.buffer).toBeUndefined()
    store.updateTerminalSnapshot('shared', snapshotB, SCOPE_B)

    store.syncTerminalSessions('/same', [{ id: 'shared', scopeKey: SCOPE_A, title: 'A', status: 'connected' }], SCOPE_A)
    expect(store.getTerminalTabs('right')).toEqual([expect.objectContaining({ id: 'shared', scopeKey: SCOPE_A })])
    expect(store.getState().panelTabs.find(tab => tab.type === 'terminal')).toMatchObject(snapshotA)

    store.syncTerminalSessions('/same', [{ id: 'shared', scopeKey: SCOPE_B, title: 'B', status: 'connected' }], SCOPE_B)
    expect(store.getState().panelTabs.find(tab => tab.type === 'terminal')).toMatchObject(snapshotB)

    const persisted = JSON.parse(localStorage.getItem('opencode-terminal-layout') ?? 'null')
    expect(persisted.directories[SCOPE_A].sessions[terminalStorageKey(SCOPE_A, 'shared')]).toMatchObject(snapshotA)
    expect(persisted.directories[SCOPE_B].sessions[terminalStorageKey(SCOPE_B, 'shared')]).toMatchObject(snapshotB)
  })

  it('replaces a colliding PTY from another scope without retaining transient state', () => {
    const store = new LayoutStore()

    store.addTerminalTab({ id: 'shared', scopeKey: SCOPE_A, title: 'A', status: 'connected' })
    store.updateTerminalSnapshot('shared', { buffer: 'scope-a', scrollY: 1, cursor: 7, rows: 24, cols: 80 }, SCOPE_A)
    store.updateTerminalCustomTitle('shared', 'Renamed A', SCOPE_A)

    store.addTerminalTab({ id: 'shared', scopeKey: SCOPE_B, title: 'B', status: 'connecting' })

    const terminals = store.getState().panelTabs.filter(tab => tab.type === 'terminal')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]).toMatchObject({
      id: 'shared',
      ptyId: 'shared',
      scopeKey: SCOPE_B,
      title: 'B',
      status: 'connecting',
    })
    expect(terminals[0].buffer).toBeUndefined()
    expect(terminals[0].customTitle).toBeUndefined()
  })

  it('persists terminal clipboard interaction preferences', () => {
    const store = new LayoutStore()

    store.setTerminalCopyOnSelect(true)
    store.setTerminalRightClickPaste(true)

    expect(localStorage.getItem('opencode-terminal-copy-on-select')).toBe('true')
    expect(localStorage.getItem('opencode-terminal-right-click-paste')).toBe('true')

    const restored = new LayoutStore().getState()
    expect(restored.terminalCopyOnSelect).toBe(true)
    expect(restored.terminalRightClickPaste).toBe(true)
  })
})

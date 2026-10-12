// ============================================
// LayoutStore - Terminal slice
// 终端标签管理 + 按目录的终端布局同步
// ============================================
import type { PanelPosition, PanelTab, TerminalTab } from './layoutStore.types'
import {
  PANEL_POSITIONS,
  buildTerminalPanelTab,
  getResolvedTerminalTitle,
  getTerminalIdentity,
  getTerminalStorageKey,
} from './layoutStore.utils'
import type { LayoutStore } from './layoutStore'

export interface TerminalSlice {
  findTerminalTab(id: string, scopeKey?: string): PanelTab | undefined
  setCurrentTerminalDirectory(directory?: string, scopeKey?: string): void
  syncTerminalSessions(directory: string | undefined, sessions: TerminalTab[], scopeKey?: string): void
  addTerminalTab(tab: TerminalTab, openPanel?: boolean, position?: PanelPosition): void
  removeTerminalTab(id: string, scopeKey?: string): void
  setActiveTerminal(id: string, scopeKey?: string): void
  updateTerminalTab(id: string, updates: Partial<Omit<TerminalTab, 'id'>>, scopeKey?: string): void
  updateTerminalShellTitle(id: string, shellTitle: string, manualMode: boolean, scopeKey?: string): void
  updateTerminalCustomTitle(id: string, customTitle: string, scopeKey?: string): void
  updateTerminalSnapshot(
    id: string,
    snapshot: Pick<PanelTab, 'buffer' | 'scrollY' | 'cursor' | 'rows' | 'cols'>,
    scopeKey?: string,
  ): void
  syncTerminalTitleMode(manualMode: boolean): void
  reorderTerminalTabs(draggedId: string, targetId: string): void
  getTerminalTabs(position?: PanelPosition): TerminalTab[]
  readonly activeTerminalId: string | null
}

export const terminalMethods: TerminalSlice & ThisType<LayoutStore> = {
  findTerminalTab(id, scopeKey) {
    return this.state.panelTabs.find(
      tab =>
        tab.type === 'terminal' &&
        (tab.ptyId ?? tab.id) === id &&
        (scopeKey === undefined || tab.scopeKey === scopeKey),
    )
  },

  setCurrentTerminalDirectory(directory, scopeKey) {
    this.currentTerminalLayoutKey = scopeKey ?? directory ?? null
  },

  syncTerminalSessions(directory, sessions, scopeKey) {
    const layoutKey = scopeKey ?? directory ?? null
    const scopeChanged = this.currentTerminalLayoutKey !== layoutKey
    const previousActiveWasTerminal = Object.fromEntries(
      PANEL_POSITIONS.map(position => [
        position,
        this.state.panelTabs.some(
          tab => tab.id === this.state.activeTabId[position] && tab.position === position && tab.type === 'terminal',
        ),
      ]),
    ) as Record<PanelPosition, boolean>
    const layoutMap = this.readTerminalLayoutMap()
    const savedLayout = layoutKey ? layoutMap.directories[layoutKey] : undefined
    const scopedSessions = sessions.map(session => ({
      ...session,
      scopeKey: session.scopeKey ?? scopeKey,
    }))
    const existingTerminalByIdentity = new Map(
      this.state.panelTabs
        .filter((tab): tab is PanelTab & { type: 'terminal' } => tab.type === 'terminal')
        .map(tab => [getTerminalIdentity({ id: tab.ptyId ?? tab.id, scopeKey: tab.scopeKey }), tab]),
    )
    const sessionByStorageKey = new Map(
      scopedSessions.map(session => {
        const storageKey = getTerminalStorageKey(session)
        return [
          storageKey,
          buildTerminalPanelTab(
            {
              ...session,
              ...savedLayout?.sessions?.[storageKey],
            },
            'bottom',
            existingTerminalByIdentity.get(getTerminalIdentity(session)),
          ),
        ]
      }),
    )

    const nonTerminalTabs = this.state.panelTabs.filter(tab => tab.type !== 'terminal')
    const nonTerminalById = new Map(nonTerminalTabs.map(tab => [tab.id, tab]))

    const orderByPosition: Record<PanelPosition, string[]> = {
      bottom: savedLayout?.order.bottom ? [...savedLayout.order.bottom] : [],
      right: savedLayout?.order.right ? [...savedLayout.order.right] : [],
    }

    for (const position of PANEL_POSITIONS) {
      const currentIds = nonTerminalTabs.filter(tab => tab.position === position).map(tab => tab.id)
      for (const id of currentIds) {
        if (!orderByPosition[position].includes(id)) {
          orderByPosition[position].push(id)
        }
      }
    }

    const assignedTerminalKeys = new Set<string>()
    const tabsByPosition: Record<PanelPosition, PanelTab[]> = {
      bottom: [],
      right: [],
    }

    for (const position of PANEL_POSITIONS) {
      for (const id of orderByPosition[position]) {
        const nonTerminalTab = nonTerminalById.get(id)
        if (nonTerminalTab && nonTerminalTab.position === position) {
          tabsByPosition[position].push(nonTerminalTab)
          continue
        }

        const terminalTab = sessionByStorageKey.get(id)
        if (terminalTab && !assignedTerminalKeys.has(id)) {
          tabsByPosition[position].push({ ...terminalTab, position })
          assignedTerminalKeys.add(id)
        }
      }
    }

    for (const session of scopedSessions) {
      const storageKey = getTerminalStorageKey(session)
      if (assignedTerminalKeys.has(storageKey)) continue
      const terminalTab = sessionByStorageKey.get(storageKey)
      if (!terminalTab) continue
      tabsByPosition.bottom.push(terminalTab)
      assignedTerminalKeys.add(storageKey)
    }

    this.state.panelTabs = [...tabsByPosition.right, ...tabsByPosition.bottom]
    this.currentTerminalLayoutKey = layoutKey

    for (const position of PANEL_POSITIONS) {
      const currentActiveId = this.state.activeTabId[position]
      const hasCurrentActive =
        (!scopeChanged || !previousActiveWasTerminal[position]) &&
        (currentActiveId
          ? this.state.panelTabs.some(tab => tab.id === currentActiveId && tab.position === position)
          : false)

      if (hasCurrentActive) {
        continue
      }

      const savedActiveKey = savedLayout?.activeTabId[position]
      const savedActiveId = savedActiveKey ? (sessionByStorageKey.get(savedActiveKey)?.id ?? savedActiveKey) : null
      const hasSavedActive = savedActiveId
        ? this.state.panelTabs.some(tab => tab.id === savedActiveId && tab.position === position)
        : false

      this.state.activeTabId[position] = hasSavedActive
        ? savedActiveId
        : (this.getTabsForPosition(position)[0]?.id ?? null)
    }

    this.notify()
  },

  addTerminalTab(tab, openPanel = true, position = 'bottom') {
    if (tab.scopeKey) {
      this.currentTerminalLayoutKey = tab.scopeKey
      this.state.panelTabs = this.state.panelTabs.filter(
        existing => existing.type !== 'terminal' || existing.scopeKey === tab.scopeKey,
      )
      for (const panelPosition of PANEL_POSITIONS) {
        const activeId = this.state.activeTabId[panelPosition]
        if (
          activeId &&
          !this.state.panelTabs.some(existing => existing.id === activeId && existing.position === panelPosition)
        ) {
          this.state.activeTabId[panelPosition] = this.getTabsForPosition(panelPosition)[0]?.id ?? null
        }
      }
    }

    const existing = this.findTerminalTab(tab.id, tab.scopeKey)
    if (existing) {
      Object.assign(existing, buildTerminalPanelTab(tab, existing.position, existing))
      this.state.activeTabId[existing.position] = existing.id
      if (openPanel) {
        this.setPanelOpen(existing.position, true)
      }
      this.notify()
      return
    }

    this.addTab(buildTerminalPanelTab(tab, position), openPanel)
  },

  removeTerminalTab(id, scopeKey) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (tab) this.removeTab(tab.id)
  },

  setActiveTerminal(id, scopeKey) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (tab) this.setActiveTab(tab.position, tab.id)
  },

  updateTerminalTab(id, updates, scopeKey) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (!tab) return
    Object.assign(tab, updates)
    this.notify()
  },

  updateTerminalShellTitle(id, shellTitle, manualMode, scopeKey) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (!tab) return
    tab.shellTitle = shellTitle
    if (!manualMode) {
      tab.title = shellTitle
    }
    this.notify()
  },

  updateTerminalCustomTitle(id, customTitle, scopeKey) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (!tab) return
    tab.customTitle = customTitle
    tab.title = customTitle
    this.notify()
  },

  updateTerminalSnapshot(id, snapshot, scopeKey) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (!tab) return
    if (
      tab.buffer === snapshot.buffer &&
      tab.scrollY === snapshot.scrollY &&
      tab.cursor === snapshot.cursor &&
      tab.rows === snapshot.rows &&
      tab.cols === snapshot.cols
    ) {
      return
    }
    tab.buffer = snapshot.buffer
    tab.scrollY = snapshot.scrollY
    tab.cursor = snapshot.cursor
    tab.rows = snapshot.rows
    tab.cols = snapshot.cols
    this.notify()
  },

  syncTerminalTitleMode(manualMode) {
    let changed = false
    for (const tab of this.state.panelTabs) {
      if (tab.type !== 'terminal') continue
      const nextTitle = manualMode ? getResolvedTerminalTitle(tab) : (tab.shellTitle ?? tab.title ?? 'Terminal')
      if (tab.title !== nextTitle) {
        tab.title = nextTitle
        changed = true
      }
    }
    if (changed) {
      this.notify()
    }
  },

  reorderTerminalTabs(draggedId, targetId) {
    this.reorderTabs('bottom', draggedId, targetId)
  },

  getTerminalTabs(position = 'bottom') {
    return this.getTabsForPosition(position)
      .filter(t => t.type === 'terminal')
      .map(t => ({
        id: t.ptyId ?? t.id,
        title: t.title ?? 'Terminal',
        status: t.status ?? 'connecting',
        scopeKey: t.scopeKey,
      }))
  },

  // 获取当前活动的终端 ID
  get activeTerminalId() {
    const activeTab = this.getActiveTab('bottom')
    if (activeTab?.type === 'terminal') {
      return activeTab.ptyId ?? activeTab.id
    }
    return null
  },
}
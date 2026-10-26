// ============================================
// LayoutStore - Panel slice
// 统一面板标签系统 + 右侧/底部面板控制
// ============================================
import type { PanelPosition, PanelTab, RightPanelView } from './layoutStore.types'
import { MAX_RIGHT_PANEL_WIDTH } from './layoutStore.utils'
import type { LayoutStore } from './layoutStore'

export interface PanelSlice {
  setPanelOpen(position: PanelPosition, open: boolean): void
  getTabsForPosition(position: PanelPosition): PanelTab[]
  getActiveTab(position: PanelPosition): PanelTab | null
  setActiveTab(position: PanelPosition, tabId: string): void
  addTab(tab: Omit<PanelTab, 'id'> & { id?: string }, openPanel?: boolean): string
  ensureStatusTab(position: PanelPosition): void
  addSingletonTab(type: PanelTab['type'], position: PanelPosition, fixedId?: string): string
  addStatusTab(position: PanelPosition): string
  addFilesTab(position: PanelPosition): string
  addChangesTab(position: PanelPosition): string
  addMcpTab(position: PanelPosition): string
  addSkillTab(position: PanelPosition): string
  addWorktreeTab(position: PanelPosition): string
  addGraphTab(position: PanelPosition): string
  addOrchestrateTab(position: PanelPosition): string
  removeTab(tabId: string): void
  updateTab(tabId: string, updates: Partial<Omit<PanelTab, 'id' | 'type'>>): void
  moveTab(tabId: string, toPosition: PanelPosition): void
  reorderTabs(position: PanelPosition, draggedId: string, targetId: string): void
  readonly rightPanelView: RightPanelView
  toggleRightPanel(view?: RightPanelView): void
  openRightPanel(view?: RightPanelView): void
  closeRightPanel(): void
  openStatusPanel(options?: { automatic?: boolean }): boolean
  setRightPanelView(view: RightPanelView): void
  setRightPanelWidth(width: number): void
  toggleBottomPanel(): void
  openBottomPanel(): void
  closeBottomPanel(): void
  setBottomPanelHeight(height: number): void
}

export const panelMethods: PanelSlice & ThisType<LayoutStore> = {
  /** 设置指定位置面板的开关状态 */
  setPanelOpen(position, open) {
    if (position === 'bottom') {
      this.state.bottomPanelOpen = open
    } else {
      this.state.rightPanelOpen = open
    }
  },

  // 获取指定位置的所有 tabs
  getTabsForPosition(position) {
    return this.state.panelTabs.filter(t => t.position === position)
  },

  // 获取指定位置的活动 tab
  getActiveTab(position) {
    const activeId = this.state.activeTabId[position]
    if (!activeId) return null
    return this.state.panelTabs.find(t => t.id === activeId && t.position === position) ?? null
  },

  setActiveTab(position, tabId) {
    const tab = this.state.panelTabs.find(t => t.id === tabId && t.position === position)
    if (tab) {
      this.state.activeTabId[position] = tabId
      this.notify()
    }
  },

  addTab(tab, openPanel = true) {
    const id = tab.id ?? `${tab.type}-${Date.now()}`
    const newTab: PanelTab = { ...tab, id }
    this.state.panelTabs.push(newTab)
    this.state.activeTabId[tab.position] = id

    if (openPanel) {
      this.setPanelOpen(tab.position, true)
    }
    this.notify()
    return id
  },

  ensureStatusTab(position) {
    const existing = this.state.panelTabs.find(tab => tab.type === 'status' && tab.position === position)
    if (!existing) {
      this.state.panelTabs.unshift({
        id: position === 'right' ? 'status' : `status-${position}`,
        type: 'status',
        position,
      })
    }

    const activeId = this.state.activeTabId[position]
    const activeExists = activeId
      ? this.state.panelTabs.some(tab => tab.id === activeId && tab.position === position)
      : false
    if (!activeExists) {
      this.state.activeTabId[position] =
        this.state.panelTabs.find(tab => tab.type === 'status' && tab.position === position)?.id ?? null
    }
  },

  addSingletonTab(type, position, fixedId) {
    const existing = this.state.panelTabs.find(t => t.type === type && t.position === position)
    if (existing) {
      this.setActiveTab(position, existing.id)
      this.setPanelOpen(position, true)
      this.notify()
      return existing.id
    }
    return this.addTab({ type, position, ...(fixedId && { id: fixedId }) })
  },

  addStatusTab(position) {
    if (position === 'right') this.rightPanelAutoOpenDismissed = false
    return this.addSingletonTab('status', position, position === 'right' ? 'status' : `status-${position}`)
  },

  addFilesTab(position) {
    return this.addTab({ type: 'files', position, previewFile: null, previewFiles: [] })
  },

  addChangesTab(position) {
    return this.addTab({ type: 'changes', position })
  },

  addMcpTab(position) {
    return this.addSingletonTab('mcp', position, 'mcp')
  },

  addSkillTab(position) {
    return this.addSingletonTab('skill', position, 'skill')
  },

  addWorktreeTab(position) {
    return this.addSingletonTab('worktree', position, 'worktree')
  },

  addGraphTab(position) {
    const existing = this.state.panelTabs.find(tab => tab.type === 'graph')
    if (!existing) return this.addTab({ id: 'graph', type: 'graph', position })
    if (existing.position !== position) {
      this.moveTab(existing.id, position)
      return existing.id
    }
    this.state.activeTabId[position] = existing.id
    this.setPanelOpen(position, true)
    this.notify()
    return existing.id
  },

  addOrchestrateTab(position) {
    const existing = this.state.panelTabs.find(tab => tab.type === 'orchestrate')
    if (!existing) return this.addTab({ id: 'orchestrate', type: 'orchestrate', position })
    if (existing.position !== position) {
      this.moveTab(existing.id, position)
      return existing.id
    }
    this.state.activeTabId[position] = existing.id
    this.setPanelOpen(position, true)
    this.notify()
    return existing.id
  },

  removeTab(tabId) {
    const index = this.state.panelTabs.findIndex(t => t.id === tabId)
    if (index === -1) return

    const tab = this.state.panelTabs[index]
    const position = tab.position
    if (tab.type === 'status' && position === 'right') {
      this.rightPanelAutoOpenDismissed = true
    }
    this.state.panelTabs.splice(index, 1)

    if (this.state.activeTabId[position] === tabId) {
      const remainingTabs = this.getTabsForPosition(position)
      const newIndex = Math.min(index, remainingTabs.length - 1)
      this.state.activeTabId[position] = remainingTabs[newIndex]?.id ?? null
    }

    if (this.getTabsForPosition(position).length === 0) {
      this.setPanelOpen(position, false)
    }

    this.notify()
  },

  updateTab(tabId, updates) {
    const tab = this.state.panelTabs.find(t => t.id === tabId)
    if (tab) {
      Object.assign(tab, updates)
      this.notify()
    }
  },

  moveTab(tabId, toPosition) {
    const tab = this.state.panelTabs.find(t => t.id === tabId)
    if (!tab || tab.position === toPosition) return

    const fromPosition = tab.position
    tab.position = toPosition

    if (this.state.activeTabId[fromPosition] === tabId) {
      const remainingTabs = this.getTabsForPosition(fromPosition)
      this.state.activeTabId[fromPosition] = remainingTabs[0]?.id ?? null
    }

    this.state.activeTabId[toPosition] = tabId
    if (toPosition === 'bottom') {
      this.state.bottomPanelOpen = true
    } else {
      this.state.rightPanelOpen = true
    }

    if (this.getTabsForPosition(fromPosition).length === 0) {
      if (fromPosition === 'bottom') {
        this.state.bottomPanelOpen = false
      } else {
        this.state.rightPanelOpen = false
      }
    }

    this.notify()
  },

  reorderTabs(position, draggedId, targetId) {
    const tabs = this.state.panelTabs
    const draggedIndex = tabs.findIndex(t => t.id === draggedId && t.position === position)
    const targetIndex = tabs.findIndex(t => t.id === targetId && t.position === position)

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
      return
    }

    const [draggedTab] = tabs.splice(draggedIndex, 1)
    tabs.splice(targetIndex, 0, draggedTab)

    this.notify()
  },

  get rightPanelView() {
    const activeTab = this.getActiveTab('right')
    if (activeTab?.type === 'status' || activeTab?.type === 'files' || activeTab?.type === 'changes') {
      return activeTab.type
    }
    return 'status'
  },

  toggleRightPanel(view) {
    if (view) {
      const currentView = this.rightPanelView
      if (view !== currentView) {
        this.setRightPanelView(view)
        this.state.rightPanelOpen = true
        this.rightPanelAutoOpenDismissed = false
      } else if (this.state.rightPanelOpen) {
        this.state.rightPanelOpen = false
        this.rightPanelAutoOpenDismissed = true
      } else {
        this.state.rightPanelOpen = true
        this.rightPanelAutoOpenDismissed = false
      }
    } else if (this.state.rightPanelOpen) {
      this.state.rightPanelOpen = false
      this.rightPanelAutoOpenDismissed = true
    } else {
      this.state.rightPanelOpen = true
      this.rightPanelAutoOpenDismissed = false
    }
    this.notify()
  },

  openRightPanel(view) {
    this.state.rightPanelOpen = true
    this.rightPanelAutoOpenDismissed = false
    if (view) {
      this.setRightPanelView(view)
      return
    }
    this.notify()
  },

  closeRightPanel() {
    this.state.rightPanelOpen = false
    this.rightPanelAutoOpenDismissed = true
    this.notify()
  },

  openStatusPanel(options) {
    if (options?.automatic && this.rightPanelAutoOpenDismissed) return false
    // Focusing a session auto-opens status, but it must not steal the panel
    // away from a dedicated tab the user opened on purpose.
    if (options?.automatic && this.getActiveTab('right')?.type === 'orchestrate') return false
    this.ensureStatusTab('right')
    this.state.activeTabId.right =
      this.state.panelTabs.find(tab => tab.type === 'status' && tab.position === 'right')?.id ?? null
    this.state.rightPanelOpen = true
    if (!options?.automatic) this.rightPanelAutoOpenDismissed = false
    this.notify()
    return true
  },

  setRightPanelView(view) {
    const tab = this.state.panelTabs.find(t => t.type === view && t.position === 'right')
    if (tab) {
      this.state.activeTabId.right = tab.id
    }
    this.notify()
  },

  setRightPanelWidth(width) {
    this.state.rightPanelWidth = Math.min(Math.max(width, 160), MAX_RIGHT_PANEL_WIDTH)
    try {
      localStorage.setItem('opencode-right-panel-width', this.state.rightPanelWidth.toString())
    } catch {
      // ignore
    }
    this.notify()
  },

  toggleBottomPanel() {
    this.state.bottomPanelOpen = !this.state.bottomPanelOpen
    this.notify()
  },

  openBottomPanel() {
    this.state.bottomPanelOpen = true
    this.notify()
  },

  closeBottomPanel() {
    this.state.bottomPanelOpen = false
    this.notify()
  },

  setBottomPanelHeight(height) {
    this.state.bottomPanelHeight = height
    try {
      localStorage.setItem('opencode-bottom-panel-height', height.toString())
    } catch {
      // ignore
    }
    this.notify()
  },
}
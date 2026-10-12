// ============================================
// LayoutStore - 全局 UI 布局状态
// ============================================
import type {
  LayoutBackup,
  LayoutSnapshot,
  LayoutState,
  PanelPosition,
  PanelTab,
  PersistedPanelLayout,
  PersistedPanelTabType,
  PersistedTerminalLayoutMap,
  PreviewFile,
  RightPanelView,
  Subscriber,
  TerminalTab,
} from './layoutStore.types'
import {
  MAX_RIGHT_PANEL_WIDTH,
  PANEL_POSITIONS,
  STORAGE_KEY_BOTTOM_PANEL_HEIGHT,
  STORAGE_KEY_PANEL_LAYOUT,
  STORAGE_KEY_RIGHT_PANEL_WIDTH,
  STORAGE_KEY_SIDEBAR,
  STORAGE_KEY_SIDEBAR_FOLDER_RECENTS,
  STORAGE_KEY_SIDEBAR_FOLDER_RECENTS_SHOW_DIFF,
  STORAGE_KEY_SIDEBAR_SHOW_CHILD_SESSIONS,
  STORAGE_KEY_TERMINAL_COPY_ON_SELECT,
  STORAGE_KEY_TERMINAL_LAYOUT,
  STORAGE_KEY_TERMINAL_RIGHT_CLICK_PASTE,
  STORAGE_KEY_VIEWPORT_SIDEBAR_WIDTH,
  STORAGE_KEY_WAKE_LOCK,
  buildPersistedPanelLayout,
  buildTerminalPanelTab,
  getPanelTerminalStorageKey,
  getResolvedTerminalTitle,
  getTerminalIdentity,
  getTerminalStorageKey,
  normalizePersistedPanelTab,
  sanitizePersistedPanelLayout,
  sanitizePersistedTerminalLayoutMap,
} from './layoutStore.utils'

export type {
  LayoutBackup,
  PanelPosition,
  PanelTab,
  PanelTabType,
  PersistedPanelLayout,
  PersistedTerminalDirectoryLayout,
  PersistedTerminalLayoutMap,
  PreviewFile,
  RightPanelView,
  TerminalTab,
} from './layoutStore.types'

export class LayoutStore {
  private state: LayoutState = {
    panelTabs: [
      { id: 'status', type: 'status', position: 'right' },
      { id: 'files', type: 'files', position: 'right', previewFile: null, previewFiles: [] },
      { id: 'changes', type: 'changes', position: 'right' },
    ],
    activeTabId: {
      bottom: null,
      right: 'status',
    },
    sidebarExpanded: true,
    sidebarFolderRecents: false,
    sidebarFolderRecentsShowDiff: true,
    sidebarShowChildSessions: false,
    rightPanelOpen: false,
    rightPanelWidth: 450,
    bottomPanelOpen: false,
    bottomPanelHeight: 250,
    wakeLock: false,
    terminalCopyOnSelect: false,
    terminalRightClickPaste: false,
  }
  private subscribers = new Set<Subscriber>()
  private currentTerminalLayoutKey: string | null = null
  private rightPanelAutoOpenDismissed = false

  private persistPanelLayout() {
    try {
      const persisted: PersistedPanelLayout = {
        version: 1,
        panelTabs: this.state.panelTabs
          .filter((tab): tab is PanelTab & { type: PersistedPanelTabType } => tab.type !== 'terminal')
          .map(tab => ({
            id: tab.id,
            type: tab.type,
            position: tab.position,
            title: tab.title,
          })),
        activeTabId: { ...this.state.activeTabId },
        rightPanelOpen: this.state.rightPanelOpen,
        bottomPanelOpen: this.state.bottomPanelOpen,
      }
      localStorage.setItem(STORAGE_KEY_PANEL_LAYOUT, JSON.stringify(persisted))
    } catch {
      // ignore
    }
  }

  private readTerminalLayoutMap(): PersistedTerminalLayoutMap {
    try {
      return sanitizePersistedTerminalLayoutMap(JSON.parse(localStorage.getItem(STORAGE_KEY_TERMINAL_LAYOUT) ?? 'null'))
    } catch {
      return { version: 1, directories: {} }
    }
  }

  private persistTerminalLayout() {
    if (!this.currentTerminalLayoutKey) return

    try {
      const layoutMap = this.readTerminalLayoutMap()
      const persistedTabId = (tab: PanelTab) => (tab.type === 'terminal' ? getPanelTerminalStorageKey(tab) : tab.id)
      const persistedActiveTabId = (position: PanelPosition) => {
        const activeId = this.state.activeTabId[position]
        if (!activeId) return null
        const activeTab = this.state.panelTabs.find(tab => tab.id === activeId && tab.position === position)
        return activeTab ? persistedTabId(activeTab) : null
      }
      layoutMap.directories[this.currentTerminalLayoutKey] = {
        order: {
          bottom: this.getTabsForPosition('bottom').map(persistedTabId),
          right: this.getTabsForPosition('right').map(persistedTabId),
        },
        activeTabId: {
          bottom: persistedActiveTabId('bottom'),
          right: persistedActiveTabId('right'),
        },
        sessions: Object.fromEntries(
          this.state.panelTabs
            .filter((tab): tab is PanelTab & { type: 'terminal' } => tab.type === 'terminal')
            .map(tab => [
              getPanelTerminalStorageKey(tab),
              {
                title: tab.title,
                shellTitle: tab.shellTitle,
                customTitle: tab.customTitle,
                buffer: tab.buffer,
                scrollY: tab.scrollY,
                cursor: tab.cursor,
                rows: tab.rows,
                cols: tab.cols,
              },
            ]),
        ),
      }
      localStorage.setItem(STORAGE_KEY_TERMINAL_LAYOUT, JSON.stringify(layoutMap))
    } catch {
      // ignore
    }
  }

  constructor() {
    // 从 localStorage 恢复状态
    try {
      // 侧边栏
      const savedSidebar = localStorage.getItem(STORAGE_KEY_SIDEBAR)
      if (savedSidebar !== null) {
        this.state.sidebarExpanded = savedSidebar !== 'false'
      }

      const savedFolderRecents = localStorage.getItem(STORAGE_KEY_SIDEBAR_FOLDER_RECENTS)
      if (savedFolderRecents !== null) {
        this.state.sidebarFolderRecents = savedFolderRecents === 'true'
      }

      const savedFolderRecentsShowDiff = localStorage.getItem(STORAGE_KEY_SIDEBAR_FOLDER_RECENTS_SHOW_DIFF)
      if (savedFolderRecentsShowDiff !== null) {
        this.state.sidebarFolderRecentsShowDiff = savedFolderRecentsShowDiff !== 'false'
      }

      const savedShowChildSessions = localStorage.getItem(STORAGE_KEY_SIDEBAR_SHOW_CHILD_SESSIONS)
      if (savedShowChildSessions !== null) {
        this.state.sidebarShowChildSessions = savedShowChildSessions === 'true'
      }

      const savedWakeLock = localStorage.getItem(STORAGE_KEY_WAKE_LOCK)
      if (savedWakeLock !== null) {
        this.state.wakeLock = savedWakeLock === 'true'
      }

      const savedTerminalCopyOnSelect = localStorage.getItem(STORAGE_KEY_TERMINAL_COPY_ON_SELECT)
      if (savedTerminalCopyOnSelect !== null) {
        this.state.terminalCopyOnSelect = savedTerminalCopyOnSelect === 'true'
      }

      const savedTerminalRightClickPaste = localStorage.getItem(STORAGE_KEY_TERMINAL_RIGHT_CLICK_PASTE)
      if (savedTerminalRightClickPaste !== null) {
        this.state.terminalRightClickPaste = savedTerminalRightClickPaste === 'true'
      }

      // 右侧面板宽度
      const savedWidth = localStorage.getItem(STORAGE_KEY_RIGHT_PANEL_WIDTH)
      if (savedWidth) {
        const width = parseInt(savedWidth)
        if (!isNaN(width) && width >= 160 && width <= MAX_RIGHT_PANEL_WIDTH) {
          this.state.rightPanelWidth = width
        }
      }

      // 底部面板高度
      const savedBottomHeight = localStorage.getItem(STORAGE_KEY_BOTTOM_PANEL_HEIGHT)
      if (savedBottomHeight) {
        const height = parseInt(savedBottomHeight)
        if (!isNaN(height) && height >= 100 && height <= 500) {
          this.state.bottomPanelHeight = height
        }
      }

      const savedPanelLayout = localStorage.getItem(STORAGE_KEY_PANEL_LAYOUT)
      if (savedPanelLayout) {
        const restored = sanitizePersistedPanelLayout(JSON.parse(savedPanelLayout))
        if (restored) {
          this.state.panelTabs = restored.panelTabs.map(normalizePersistedPanelTab)
          this.state.activeTabId = { ...restored.activeTabId }
          this.state.rightPanelOpen = restored.rightPanelOpen
          this.state.bottomPanelOpen = restored.bottomPanelOpen
        }
      }
      this.ensureStatusTab('right')
    } catch {
      // ignore
    }
  }

  // ============================================
  // Subscription
  // ============================================

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  private notify() {
    this.persistPanelLayout()
    this.persistTerminalLayout()
    this.subscribers.forEach(fn => fn())
  }

  // ============================================
  // Sidebar
  // ============================================

  getSidebarExpanded(): boolean {
    return this.state.sidebarExpanded
  }

  setSidebarExpanded(expanded: boolean) {
    if (this.state.sidebarExpanded === expanded) return
    this.state.sidebarExpanded = expanded
    try {
      localStorage.setItem(STORAGE_KEY_SIDEBAR, String(expanded))
    } catch {
      // ignore
    }
    this.notify()
  }

  setSidebarFolderRecents(enabled: boolean) {
    if (this.state.sidebarFolderRecents === enabled) return
    this.state.sidebarFolderRecents = enabled
    try {
      localStorage.setItem(STORAGE_KEY_SIDEBAR_FOLDER_RECENTS, String(enabled))
    } catch {
      // ignore
    }
    this.notify()
  }

  setSidebarFolderRecentsShowDiff(enabled: boolean) {
    if (this.state.sidebarFolderRecentsShowDiff === enabled) return
    this.state.sidebarFolderRecentsShowDiff = enabled
    try {
      localStorage.setItem(STORAGE_KEY_SIDEBAR_FOLDER_RECENTS_SHOW_DIFF, String(enabled))
    } catch {
      // ignore
    }
    this.notify()
  }

  setSidebarShowChildSessions(enabled: boolean) {
    if (this.state.sidebarShowChildSessions === enabled) return
    this.state.sidebarShowChildSessions = enabled
    try {
      localStorage.setItem(STORAGE_KEY_SIDEBAR_SHOW_CHILD_SESSIONS, String(enabled))
    } catch {
      /* ignore */
    }
    this.notify()
  }

  setWakeLock(enabled: boolean) {
    if (this.state.wakeLock === enabled) return
    this.state.wakeLock = enabled
    try {
      localStorage.setItem(STORAGE_KEY_WAKE_LOCK, String(enabled))
    } catch {
      /* ignore */
    }
    this.notify()
  }

  setTerminalCopyOnSelect(enabled: boolean) {
    if (this.state.terminalCopyOnSelect === enabled) return
    this.state.terminalCopyOnSelect = enabled
    try {
      localStorage.setItem(STORAGE_KEY_TERMINAL_COPY_ON_SELECT, String(enabled))
    } catch {
      /* ignore */
    }
    this.notify()
  }

  setTerminalRightClickPaste(enabled: boolean) {
    if (this.state.terminalRightClickPaste === enabled) return
    this.state.terminalRightClickPaste = enabled
    try {
      localStorage.setItem(STORAGE_KEY_TERMINAL_RIGHT_CLICK_PASTE, String(enabled))
    } catch {
      /* ignore */
    }
    this.notify()
  }

  toggleSidebar() {
    this.setSidebarExpanded(!this.state.sidebarExpanded)
  }

  // ============================================
  // 辅助方法
  // ============================================

  /** 设置指定位置面板的开关状态 */
  private setPanelOpen(position: PanelPosition, open: boolean) {
    if (position === 'bottom') {
      this.state.bottomPanelOpen = open
    } else {
      this.state.rightPanelOpen = open
    }
  }

  // ============================================
  // 新的统一 Panel Tab API
  // ============================================

  // 获取指定位置的所有 tabs
  getTabsForPosition(position: PanelPosition): PanelTab[] {
    return this.state.panelTabs.filter(t => t.position === position)
  }

  // 获取指定位置的活动 tab
  getActiveTab(position: PanelPosition): PanelTab | null {
    const activeId = this.state.activeTabId[position]
    if (!activeId) return null
    return this.state.panelTabs.find(t => t.id === activeId && t.position === position) ?? null
  }

  setActiveTab(position: PanelPosition, tabId: string) {
    const tab = this.state.panelTabs.find(t => t.id === tabId && t.position === position)
    if (tab) {
      this.state.activeTabId[position] = tabId
      this.notify()
    }
  }

  addTab(tab: Omit<PanelTab, 'id'> & { id?: string }, openPanel = true) {
    const id = tab.id ?? `${tab.type}-${Date.now()}`
    const newTab: PanelTab = { ...tab, id }
    this.state.panelTabs.push(newTab)
    this.state.activeTabId[tab.position] = id

    if (openPanel) {
      this.setPanelOpen(tab.position, true)
    }
    this.notify()
    return id
  }

  private ensureStatusTab(position: PanelPosition) {
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
  }

  private addSingletonTab(type: PanelTab['type'], position: PanelPosition, fixedId?: string): string {
    const existing = this.state.panelTabs.find(t => t.type === type && t.position === position)
    if (existing) {
      this.setActiveTab(position, existing.id)
      this.setPanelOpen(position, true)
      this.notify()
      return existing.id
    }
    return this.addTab({ type, position, ...(fixedId && { id: fixedId }) })
  }

  addStatusTab(position: PanelPosition) {
    if (position === 'right') this.rightPanelAutoOpenDismissed = false
    return this.addSingletonTab('status', position, position === 'right' ? 'status' : `status-${position}`)
  }

  addFilesTab(position: PanelPosition) {
    return this.addTab({ type: 'files', position, previewFile: null, previewFiles: [] })
  }

  addChangesTab(position: PanelPosition) {
    return this.addTab({ type: 'changes', position })
  }

  addMcpTab(position: PanelPosition) {
    return this.addSingletonTab('mcp', position, 'mcp')
  }

  addSkillTab(position: PanelPosition) {
    return this.addSingletonTab('skill', position, 'skill')
  }

  addWorktreeTab(position: PanelPosition) {
    return this.addSingletonTab('worktree', position, 'worktree')
  }

  addGraphTab(position: PanelPosition) {
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
  }

  removeTab(tabId: string) {
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
  }

  updateTab(tabId: string, updates: Partial<Omit<PanelTab, 'id' | 'type'>>) {
    const tab = this.state.panelTabs.find(t => t.id === tabId)
    if (tab) {
      Object.assign(tab, updates)
      this.notify()
    }
  }

  moveTab(tabId: string, toPosition: PanelPosition) {
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
  }

  reorderTabs(position: PanelPosition, draggedId: string, targetId: string) {
    const tabs = this.state.panelTabs
    const draggedIndex = tabs.findIndex(t => t.id === draggedId && t.position === position)
    const targetIndex = tabs.findIndex(t => t.id === targetId && t.position === position)

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
      return
    }

    const [draggedTab] = tabs.splice(draggedIndex, 1)
    tabs.splice(targetIndex, 0, draggedTab)

    this.notify()
  }

  get rightPanelView(): RightPanelView {
    const activeTab = this.getActiveTab('right')
    if (activeTab?.type === 'status' || activeTab?.type === 'files' || activeTab?.type === 'changes') {
      return activeTab.type
    }
    return 'status'
  }

  toggleRightPanel(view?: RightPanelView) {
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
  }

  openRightPanel(view?: RightPanelView) {
    this.state.rightPanelOpen = true
    this.rightPanelAutoOpenDismissed = false
    if (view) {
      this.setRightPanelView(view)
      return
    }
    this.notify()
  }

  closeRightPanel() {
    this.state.rightPanelOpen = false
    this.rightPanelAutoOpenDismissed = true
    this.notify()
  }

  openStatusPanel(options?: { automatic?: boolean }) {
    if (options?.automatic && this.rightPanelAutoOpenDismissed) return false
    this.ensureStatusTab('right')
    this.state.activeTabId.right =
      this.state.panelTabs.find(tab => tab.type === 'status' && tab.position === 'right')?.id ?? null
    this.state.rightPanelOpen = true
    if (!options?.automatic) this.rightPanelAutoOpenDismissed = false
    this.notify()
    return true
  }

  setRightPanelView(view: RightPanelView) {
    const tab = this.state.panelTabs.find(t => t.type === view && t.position === 'right')
    if (tab) {
      this.state.activeTabId.right = tab.id
    }
    this.notify()
  }

  setRightPanelWidth(width: number) {
    this.state.rightPanelWidth = Math.min(Math.max(width, 160), MAX_RIGHT_PANEL_WIDTH)
    try {
      localStorage.setItem(STORAGE_KEY_RIGHT_PANEL_WIDTH, this.state.rightPanelWidth.toString())
    } catch {
      // ignore
    }
    this.notify()
  }

  // ============================================
  // File Preview Actions
  // ============================================

  openFilePreview(file: PreviewFile, position?: PanelPosition) {
    const targetTab = this.getTargetFilesTab(position)
    if (!targetTab) return

    const previewFiles = targetTab.previewFiles ?? []
    const existingIndex = previewFiles.findIndex(item => item.path === file.path)
    const nextPreviewFiles =
      existingIndex === -1 ? [...previewFiles, file] : previewFiles.map(item => (item.path === file.path ? file : item))

    targetTab.previewFiles = nextPreviewFiles
    targetTab.previewFile = file
    this.state.activeTabId[targetTab.position] = targetTab.id
    this.setPanelOpen(targetTab.position, true)
    this.notify()
  }

  activateFilePreview(tabId: string, path: string) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    const file = tab?.previewFiles?.find(item => item.path === path)
    if (!tab || !file) return
    tab.previewFile = file
    this.notify()
  }

  closeFilePreview(tabId: string, path?: string) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    const previewFiles = tab?.previewFiles
    const targetPath = path ?? tab?.previewFile?.path
    if (!tab || !previewFiles || !targetPath) return

    const index = previewFiles.findIndex(item => item.path === targetPath)
    if (index === -1) return

    const isActive = tab.previewFile?.path === targetPath
    const nextPreviewFiles = previewFiles.filter(item => item.path !== targetPath)

    tab.previewFiles = nextPreviewFiles

    if (nextPreviewFiles.length === 0) {
      tab.previewFile = null
    } else if (isActive) {
      const nextIndex = Math.min(index, nextPreviewFiles.length - 1)
      tab.previewFile = nextPreviewFiles[nextIndex] ?? null
    }

    this.notify()
  }

  closeAllFilePreviews(tabId: string) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    if (!tab) return
    tab.previewFile = null
    tab.previewFiles = []
    this.notify()
  }

  reorderFilePreviews(tabId: string, draggedPath: string, targetPath: string) {
    const tab = this.state.panelTabs.find(item => item.id === tabId && item.type === 'files')
    const previewFiles = tab?.previewFiles
    if (!tab || !previewFiles) return

    const draggedIndex = previewFiles.findIndex(item => item.path === draggedPath)
    const targetIndex = previewFiles.findIndex(item => item.path === targetPath)

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return

    const nextPreviewFiles = [...previewFiles]
    const [dragged] = nextPreviewFiles.splice(draggedIndex, 1)
    nextPreviewFiles.splice(targetIndex, 0, dragged)
    tab.previewFiles = nextPreviewFiles
    this.notify()
  }

  private getTargetFilesTab(position?: PanelPosition): PanelTab | null {
    if (position) {
      const activeId = this.state.activeTabId[position]
      const activeFilesTab = this.state.panelTabs.find(
        t => t.id === activeId && t.type === 'files' && t.position === position,
      )
      if (activeFilesTab) return activeFilesTab

      const filesTab = this.state.panelTabs.find(t => t.type === 'files' && t.position === position)
      if (filesTab) return filesTab

      const id = this.addFilesTab(position)
      return this.state.panelTabs.find(t => t.id === id) ?? null
    }

    const preferred = (['right', 'bottom'] as const)
      .map(pos =>
        this.state.panelTabs.find(
          t => t.id === this.state.activeTabId[pos] && t.type === 'files' && t.position === pos,
        ),
      )
      .find(Boolean)
    if (preferred) return preferred

    return this.state.panelTabs.find(t => t.type === 'files') ?? null
  }

  // ============================================
  // 兼容旧 API - Bottom Panel
  // ============================================

  toggleBottomPanel() {
    this.state.bottomPanelOpen = !this.state.bottomPanelOpen
    this.notify()
  }

  openBottomPanel() {
    this.state.bottomPanelOpen = true
    this.notify()
  }

  closeBottomPanel() {
    this.state.bottomPanelOpen = false
    this.notify()
  }

  setBottomPanelHeight(height: number) {
    this.state.bottomPanelHeight = height
    try {
      localStorage.setItem('opencode-bottom-panel-height', height.toString())
    } catch {
      // ignore
    }
    this.notify()
  }

  // ============================================
  // 兼容旧 API - Terminal Tabs
  // ============================================

  private findTerminalTab(id: string, scopeKey?: string) {
    return this.state.panelTabs.find(
      tab =>
        tab.type === 'terminal' &&
        (tab.ptyId ?? tab.id) === id &&
        (scopeKey === undefined || tab.scopeKey === scopeKey),
    )
  }

  setCurrentTerminalDirectory(directory?: string, scopeKey?: string) {
    this.currentTerminalLayoutKey = scopeKey ?? directory ?? null
  }

  syncTerminalSessions(directory: string | undefined, sessions: TerminalTab[], scopeKey?: string) {
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
  }

  addTerminalTab(tab: TerminalTab, openPanel = true, position: PanelPosition = 'bottom') {
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
  }

  removeTerminalTab(id: string, scopeKey?: string) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (tab) this.removeTab(tab.id)
  }

  setActiveTerminal(id: string, scopeKey?: string) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (tab) this.setActiveTab(tab.position, tab.id)
  }

  updateTerminalTab(id: string, updates: Partial<Omit<TerminalTab, 'id'>>, scopeKey?: string) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (!tab) return
    Object.assign(tab, updates)
    this.notify()
  }

  updateTerminalShellTitle(id: string, shellTitle: string, manualMode: boolean, scopeKey?: string) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (!tab) return
    tab.shellTitle = shellTitle
    if (!manualMode) {
      tab.title = shellTitle
    }
    this.notify()
  }

  updateTerminalCustomTitle(id: string, customTitle: string, scopeKey?: string) {
    const tab = this.findTerminalTab(id, scopeKey)
    if (!tab) return
    tab.customTitle = customTitle
    tab.title = customTitle
    this.notify()
  }

  updateTerminalSnapshot(
    id: string,
    snapshot: Pick<PanelTab, 'buffer' | 'scrollY' | 'cursor' | 'rows' | 'cols'>,
    scopeKey?: string,
  ) {
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
  }

  syncTerminalTitleMode(manualMode: boolean) {
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
  }

  reorderTerminalTabs(draggedId: string, targetId: string) {
    this.reorderTabs('bottom', draggedId, targetId)
  }

  getTerminalTabs(position: PanelPosition = 'bottom'): TerminalTab[] {
    return this.getTabsForPosition(position)
      .filter(t => t.type === 'terminal')
      .map(t => ({
        id: t.ptyId ?? t.id,
        title: t.title ?? 'Terminal',
        status: t.status ?? 'connecting',
        scopeKey: t.scopeKey,
      }))
  }

  // 获取当前活动的终端 ID
  get activeTerminalId(): string | null {
    const activeTab = this.getActiveTab('bottom')
    if (activeTab?.type === 'terminal') {
      return activeTab.ptyId ?? activeTab.id
    }
    return null
  }

  getState() {
    return this.state
  }
}

export const layoutStore = new LayoutStore()

export function exportLayoutBackup(): LayoutBackup {
  const state = layoutStore.getState()
  const rawSidebarWidth = localStorage.getItem(STORAGE_KEY_VIEWPORT_SIDEBAR_WIDTH)
  const sidebarWidth = rawSidebarWidth !== null ? Number.parseInt(rawSidebarWidth, 10) : null
  let terminalLayout: PersistedTerminalLayoutMap

  try {
    terminalLayout = sanitizePersistedTerminalLayoutMap(
      JSON.parse(localStorage.getItem(STORAGE_KEY_TERMINAL_LAYOUT) ?? 'null'),
    )
  } catch {
    terminalLayout = { version: 1, directories: {} }
  }

  return {
    sidebarExpanded: state.sidebarExpanded,
    sidebarFolderRecents: state.sidebarFolderRecents,
    sidebarFolderRecentsShowDiff: state.sidebarFolderRecentsShowDiff,
    sidebarShowChildSessions: state.sidebarShowChildSessions,
    wakeLock: state.wakeLock,
    rightPanelWidth: state.rightPanelWidth,
    bottomPanelHeight: state.bottomPanelHeight,
    panelLayout: buildPersistedPanelLayout(state),
    terminalLayout,
    sidebarWidth: Number.isFinite(sidebarWidth) ? sidebarWidth : null,
  }
}

export function importLayoutBackup(raw: unknown): void {
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const panelLayout =
    sanitizePersistedPanelLayout(parsed?.panelLayout) ?? buildPersistedPanelLayout(layoutStore.getState())
  const terminalLayout = sanitizePersistedTerminalLayoutMap(parsed?.terminalLayout)
  const rightPanelWidth =
    typeof parsed?.rightPanelWidth === 'number'
      ? Math.min(Math.max(Math.round(parsed.rightPanelWidth), 160), MAX_RIGHT_PANEL_WIDTH)
      : 450
  const bottomPanelHeight =
    typeof parsed?.bottomPanelHeight === 'number'
      ? Math.min(Math.max(Math.round(parsed.bottomPanelHeight), 100), 500)
      : 250
  const sidebarWidth =
    typeof parsed?.sidebarWidth === 'number' && Number.isFinite(parsed.sidebarWidth) && parsed.sidebarWidth > 0
      ? Math.round(parsed.sidebarWidth)
      : null

  localStorage.setItem(STORAGE_KEY_SIDEBAR, String(parsed?.sidebarExpanded === true))
  localStorage.setItem(STORAGE_KEY_SIDEBAR_FOLDER_RECENTS, String(parsed?.sidebarFolderRecents === true))
  localStorage.setItem(
    STORAGE_KEY_SIDEBAR_FOLDER_RECENTS_SHOW_DIFF,
    String(parsed?.sidebarFolderRecentsShowDiff !== false),
  )
  localStorage.setItem(STORAGE_KEY_SIDEBAR_SHOW_CHILD_SESSIONS, String(parsed?.sidebarShowChildSessions === true))
  localStorage.setItem(STORAGE_KEY_WAKE_LOCK, String(parsed?.wakeLock === true))
  localStorage.setItem(STORAGE_KEY_RIGHT_PANEL_WIDTH, String(rightPanelWidth))
  localStorage.setItem(STORAGE_KEY_BOTTOM_PANEL_HEIGHT, String(bottomPanelHeight))
  localStorage.setItem(STORAGE_KEY_PANEL_LAYOUT, JSON.stringify(panelLayout))
  localStorage.setItem(STORAGE_KEY_TERMINAL_LAYOUT, JSON.stringify(terminalLayout))

  if (sidebarWidth !== null) {
    localStorage.setItem(STORAGE_KEY_VIEWPORT_SIDEBAR_WIDTH, String(sidebarWidth))
  } else {
    localStorage.removeItem(STORAGE_KEY_VIEWPORT_SIDEBAR_WIDTH)
  }
}

// ============================================
// React Hook
// ============================================

import { useSyncExternalStore } from 'react'

let cachedSnapshot: LayoutSnapshot | null = null

function getSnapshot(): LayoutSnapshot {
  if (!cachedSnapshot) {
    const state = layoutStore.getState()
    cachedSnapshot = {
      ...state,
      // 派生属性
      rightPanelView: layoutStore.rightPanelView,
      terminalTabs: layoutStore.getTerminalTabs(),
      activeTerminalId: layoutStore.activeTerminalId,
    }
  }
  return cachedSnapshot
}

// 订阅更新时清除缓存
layoutStore.subscribe(() => {
  cachedSnapshot = null
})

export function useLayoutStore() {
  return useSyncExternalStore(cb => layoutStore.subscribe(cb), getSnapshot, getSnapshot)
}

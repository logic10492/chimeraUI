// ============================================
// LayoutStore - 全局 UI 布局状态
// ============================================

// 面板位置
export type PanelPosition = 'bottom' | 'right'

// 面板内容类型
export type PanelTabType = 'status' | 'terminal' | 'files' | 'changes' | 'mcp' | 'skill' | 'worktree'
type PersistedPanelTabType = Exclude<PanelTabType, 'terminal'>

// 统一的面板标签
export interface PanelTab {
  id: string
  type: PanelTabType
  position: PanelPosition
  previewFile?: PreviewFile | null
  previewFiles?: PreviewFile[]
  // Terminal 特有属性
  ptyId?: string
  scopeKey?: string
  title?: string
  shellTitle?: string
  customTitle?: string
  buffer?: string
  scrollY?: number
  cursor?: number
  rows?: number
  cols?: number
  status?: 'connecting' | 'connected' | 'disconnected' | 'exited'
}

// 文件预览的文件信息
export interface PreviewFile {
  path: string
  name: string
}

const MAX_RIGHT_PANEL_WIDTH = 1280

// 兼容旧的 TerminalTab 类型
export interface TerminalTab {
  id: string // PTY session ID
  scopeKey?: string
  title: string // 显示标题
  status: 'connecting' | 'connected' | 'disconnected' | 'exited'
  shellTitle?: string
  customTitle?: string
  buffer?: string
  scrollY?: number
  cursor?: number
  rows?: number
  cols?: number
}

function getResolvedTerminalTitle(tab: Pick<PanelTab, 'title' | 'shellTitle' | 'customTitle'>): string {
  return tab.customTitle ?? tab.title ?? tab.shellTitle ?? 'Terminal'
}

function getTerminalIdentity(tab: Pick<TerminalTab, 'id' | 'scopeKey'>): string {
  return `${tab.scopeKey ?? ''}\u0000${tab.id}`
}

function getTerminalStorageKey(tab: Pick<TerminalTab, 'id' | 'scopeKey'>): string {
  return tab.scopeKey ? getTerminalIdentity(tab) : tab.id
}

function getPanelTerminalStorageKey(tab: Pick<PanelTab, 'id' | 'ptyId' | 'scopeKey'>): string {
  return getTerminalStorageKey({ id: tab.ptyId ?? tab.id, scopeKey: tab.scopeKey })
}

function buildTerminalPanelTab(
  tab: TerminalTab,
  position: PanelPosition,
  existing?: PanelTab,
): PanelTab & { type: 'terminal'; ptyId: string } {
  return {
    id: tab.id,
    type: 'terminal',
    position,
    ptyId: tab.id,
    scopeKey: tab.scopeKey,
    title: existing?.title ?? tab.title,
    shellTitle: existing?.shellTitle ?? tab.shellTitle ?? tab.title,
    customTitle: existing?.customTitle ?? tab.customTitle,
    buffer: existing?.buffer ?? tab.buffer,
    scrollY: existing?.scrollY ?? tab.scrollY,
    cursor: existing?.cursor ?? tab.cursor,
    rows: existing?.rows ?? tab.rows,
    cols: existing?.cols ?? tab.cols,
    status: tab.status,
  }
}

// 旧的 RightPanelView 类型 - 兼容
export type RightPanelView = 'status' | 'files' | 'changes'

interface LayoutState {
  // 统一的面板标签系统
  panelTabs: PanelTab[]
  activeTabId: {
    bottom: string | null
    right: string | null
  }

  // 侧边栏
  sidebarExpanded: boolean
  sidebarFolderRecents: boolean
  sidebarFolderRecentsShowDiff: boolean
  sidebarShowChildSessions: boolean

  // 右侧栏
  rightPanelOpen: boolean
  rightPanelWidth: number

  // 底部面板
  bottomPanelOpen: boolean
  bottomPanelHeight: number

  // 屏幕常亮
  wakeLock: boolean

  // 终端交互
  terminalCopyOnSelect: boolean
  terminalRightClickPaste: boolean
}

type Subscriber = () => void

const STORAGE_KEY_WAKE_LOCK = 'opencode-wake-lock'
const STORAGE_KEY_SIDEBAR = 'opencode-sidebar-expanded'
const STORAGE_KEY_SIDEBAR_FOLDER_RECENTS = 'opencode-sidebar-folder-recents'
const STORAGE_KEY_SIDEBAR_FOLDER_RECENTS_SHOW_DIFF = 'opencode-sidebar-folder-recents-show-diff'
const STORAGE_KEY_SIDEBAR_SHOW_CHILD_SESSIONS = 'opencode-sidebar-show-child-sessions'
const STORAGE_KEY_PANEL_LAYOUT = 'opencode-panel-layout'
const STORAGE_KEY_TERMINAL_LAYOUT = 'opencode-terminal-layout'
const STORAGE_KEY_RIGHT_PANEL_WIDTH = 'opencode-right-panel-width'
const STORAGE_KEY_BOTTOM_PANEL_HEIGHT = 'opencode-bottom-panel-height'
const STORAGE_KEY_VIEWPORT_SIDEBAR_WIDTH = 'sidebar-width'
const STORAGE_KEY_TERMINAL_COPY_ON_SELECT = 'opencode-terminal-copy-on-select'
const STORAGE_KEY_TERMINAL_RIGHT_CLICK_PASTE = 'opencode-terminal-right-click-paste'

interface PersistedPanelTab {
  id: string
  type: PersistedPanelTabType
  position: PanelPosition
  title?: string
}

export interface PersistedPanelLayout {
  version: 1
  panelTabs: PersistedPanelTab[]
  activeTabId: LayoutState['activeTabId']
  rightPanelOpen: boolean
  bottomPanelOpen: boolean
}

export interface PersistedTerminalDirectoryLayout {
  order: Record<PanelPosition, string[]>
  activeTabId: LayoutState['activeTabId']
  sessions?: Record<string, PersistedTerminalSessionState>
}

interface PersistedTerminalSessionState {
  title?: string
  shellTitle?: string
  customTitle?: string
  buffer?: string
  scrollY?: number
  cursor?: number
  rows?: number
  cols?: number
}

export interface PersistedTerminalLayoutMap {
  version: 1
  directories: Record<string, PersistedTerminalDirectoryLayout>
}

const PANEL_POSITIONS: PanelPosition[] = ['bottom', 'right']
const PERSISTED_PANEL_TAB_TYPES: PersistedPanelTabType[] = ['status', 'files', 'changes', 'mcp', 'skill', 'worktree']

function isPanelPosition(value: unknown): value is PanelPosition {
  return typeof value === 'string' && PANEL_POSITIONS.includes(value as PanelPosition)
}

function isPersistedPanelTabType(value: unknown): value is PersistedPanelTabType {
  return typeof value === 'string' && PERSISTED_PANEL_TAB_TYPES.includes(value as PersistedPanelTabType)
}

function normalizePersistedPanelTab(tab: PersistedPanelTab): PanelTab {
  if (tab.type === 'files') {
    return {
      id: tab.id,
      type: 'files',
      position: tab.position,
      title: tab.title,
      previewFile: null,
      previewFiles: [],
    }
  }

  return {
    id: tab.id,
    type: tab.type,
    position: tab.position,
    title: tab.title,
  }
}

function sanitizePersistedPanelLayout(raw: unknown): PersistedPanelLayout | null {
  if (!raw || typeof raw !== 'object') return null

  const data = raw as Partial<PersistedPanelLayout>
  if (
    data.version !== 1 ||
    !Array.isArray(data.panelTabs) ||
    !data.activeTabId ||
    typeof data.activeTabId !== 'object'
  ) {
    return null
  }

  const seenIds = new Set<string>()
  const panelTabs: PersistedPanelTab[] = []
  for (const item of data.panelTabs) {
    if (!item || typeof item !== 'object') continue
    const tab = item as Partial<PersistedPanelTab>
    if (typeof tab.id !== 'string' || !tab.id || seenIds.has(tab.id)) continue
    if (!isPersistedPanelTabType(tab.type) || !isPanelPosition(tab.position)) continue
    if (tab.title !== undefined && typeof tab.title !== 'string') continue
    seenIds.add(tab.id)
    panelTabs.push({ id: tab.id, type: tab.type, position: tab.position, title: tab.title })
  }

  return {
    version: 1,
    panelTabs,
    activeTabId: {
      bottom: typeof data.activeTabId.bottom === 'string' ? data.activeTabId.bottom : null,
      right: typeof data.activeTabId.right === 'string' ? data.activeTabId.right : null,
    },
    rightPanelOpen: data.rightPanelOpen === true,
    bottomPanelOpen: data.bottomPanelOpen === true,
  }
}

function sanitizePersistedTerminalLayoutMap(raw: unknown): PersistedTerminalLayoutMap {
  if (!raw || typeof raw !== 'object') {
    return { version: 1, directories: {} }
  }

  const data = raw as Partial<PersistedTerminalLayoutMap>
  if (data.version !== 1 || !data.directories || typeof data.directories !== 'object') {
    return { version: 1, directories: {} }
  }

  const directories: Record<string, PersistedTerminalDirectoryLayout> = {}

  for (const [directory, value] of Object.entries(data.directories)) {
    if (!directory || !value || typeof value !== 'object') continue
    const entry = value as Partial<PersistedTerminalDirectoryLayout>
    const rawOrder = entry.order
    const rawActiveTabId = entry.activeTabId
    if (!rawOrder || typeof rawOrder !== 'object' || !rawActiveTabId || typeof rawActiveTabId !== 'object') continue

    const order = {
      bottom: Array.isArray(rawOrder.bottom)
        ? rawOrder.bottom.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [],
      right: Array.isArray(rawOrder.right)
        ? rawOrder.right.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [],
    }

    const sessions: Record<string, PersistedTerminalSessionState> = {}
    const rawSessions = entry.sessions
    if (rawSessions && typeof rawSessions === 'object') {
      for (const [id, session] of Object.entries(rawSessions)) {
        if (!id || !session || typeof session !== 'object') continue
        const data = session as Partial<PersistedTerminalSessionState>
        sessions[id] = {
          title: typeof data.title === 'string' ? data.title : undefined,
          shellTitle: typeof data.shellTitle === 'string' ? data.shellTitle : undefined,
          customTitle: typeof data.customTitle === 'string' ? data.customTitle : undefined,
          buffer: typeof data.buffer === 'string' ? data.buffer : undefined,
          scrollY: typeof data.scrollY === 'number' ? data.scrollY : undefined,
          cursor: typeof data.cursor === 'number' ? data.cursor : undefined,
          rows: typeof data.rows === 'number' ? data.rows : undefined,
          cols: typeof data.cols === 'number' ? data.cols : undefined,
        }
      }
    }

    directories[directory] = {
      order,
      activeTabId: {
        bottom: typeof rawActiveTabId.bottom === 'string' ? rawActiveTabId.bottom : null,
        right: typeof rawActiveTabId.right === 'string' ? rawActiveTabId.right : null,
      },
      sessions,
    }
  }

  return { version: 1, directories }
}

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

export interface LayoutBackup {
  sidebarExpanded: boolean
  sidebarFolderRecents: boolean
  sidebarFolderRecentsShowDiff: boolean
  sidebarShowChildSessions: boolean
  wakeLock: boolean
  rightPanelWidth: number
  bottomPanelHeight: number
  panelLayout: PersistedPanelLayout
  terminalLayout: PersistedTerminalLayoutMap
  sidebarWidth: number | null
}

function buildPersistedPanelLayout(state: LayoutState): PersistedPanelLayout {
  return {
    version: 1,
    panelTabs: state.panelTabs
      .filter((tab): tab is PanelTab & { type: PersistedPanelTabType } => tab.type !== 'terminal')
      .map(tab => ({
        id: tab.id,
        type: tab.type,
        position: tab.position,
        title: tab.title,
      })),
    activeTabId: { ...state.activeTabId },
    rightPanelOpen: state.rightPanelOpen,
    bottomPanelOpen: state.bottomPanelOpen,
  }
}

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

// 兼容的 snapshot 类型，包含派生属性
interface LayoutSnapshot extends LayoutState {
  // 派生属性 - 兼容旧组件
  rightPanelView: RightPanelView
  terminalTabs: TerminalTab[]
  activeTerminalId: string | null
}

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

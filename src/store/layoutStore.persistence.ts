// ============================================
// LayoutStore - Persistence slice
// 面板/终端布局的持久化与启动恢复
// ============================================
import type {
  LayoutState,
  PanelPosition,
  PanelTab,
  PersistedPanelLayout,
  PersistedPanelTabType,
  PersistedTerminalLayoutMap,
} from './layoutStore.types'
import {
  MAX_RIGHT_PANEL_WIDTH,
  STORAGE_KEY_BOTTOM_PANEL_HEIGHT,
  STORAGE_KEY_PANEL_LAYOUT,
  STORAGE_KEY_RIGHT_PANEL_WIDTH,
  STORAGE_KEY_SIDEBAR,
  STORAGE_KEY_SIDEBAR_FOLDER_RECENTS,
  STORAGE_KEY_SIDEBAR_FOLDER_RECENTS_SHOW_DIFF,
  STORAGE_KEY_SIDEBAR_ACTIVE_SECTION_COLLAPSED,
  STORAGE_KEY_SIDEBAR_SHOW_CHILD_SESSIONS,
  STORAGE_KEY_TERMINAL_COPY_ON_SELECT,
  STORAGE_KEY_TERMINAL_LAYOUT,
  STORAGE_KEY_TERMINAL_RIGHT_CLICK_PASTE,
  STORAGE_KEY_WAKE_LOCK,
  getPanelTerminalStorageKey,
  normalizePersistedPanelTab,
  sanitizePersistedPanelLayout,
  sanitizePersistedTerminalLayoutMap,
} from './layoutStore.utils'
import type { LayoutStore } from './layoutStore'

export interface PersistenceSlice {
  persistPanelLayout(): void
  readTerminalLayoutMap(): PersistedTerminalLayoutMap
  persistTerminalLayout(): void
}

export const persistenceMethods: PersistenceSlice & ThisType<LayoutStore> = {
  persistPanelLayout() {
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
  },

  readTerminalLayoutMap() {
    try {
      return sanitizePersistedTerminalLayoutMap(JSON.parse(localStorage.getItem(STORAGE_KEY_TERMINAL_LAYOUT) ?? 'null'))
    } catch {
      return { version: 1, directories: {} }
    }
  },

  persistTerminalLayout() {
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
  },
}

/**
 * 从 localStorage 恢复布局状态到给定 state（不含 status tab 的兜底，由 store 构造器补全）。
 * 读取异常由调用方捕获。
 */
export function restoreLayoutState(state: LayoutState): void {
  // 侧边栏
  const savedSidebar = localStorage.getItem(STORAGE_KEY_SIDEBAR)
  if (savedSidebar !== null) {
    state.sidebarExpanded = savedSidebar !== 'false'
  }

  const savedFolderRecents = localStorage.getItem(STORAGE_KEY_SIDEBAR_FOLDER_RECENTS)
  if (savedFolderRecents !== null) {
    state.sidebarFolderRecents = savedFolderRecents === 'true'
  }

  const savedFolderRecentsShowDiff = localStorage.getItem(STORAGE_KEY_SIDEBAR_FOLDER_RECENTS_SHOW_DIFF)
  if (savedFolderRecentsShowDiff !== null) {
    state.sidebarFolderRecentsShowDiff = savedFolderRecentsShowDiff !== 'false'
  }

  const savedShowChildSessions = localStorage.getItem(STORAGE_KEY_SIDEBAR_SHOW_CHILD_SESSIONS)
  if (savedShowChildSessions !== null) {
    state.sidebarShowChildSessions = savedShowChildSessions === 'true'
  }

  const savedActiveSectionCollapsed = localStorage.getItem(STORAGE_KEY_SIDEBAR_ACTIVE_SECTION_COLLAPSED)
  if (savedActiveSectionCollapsed !== null) {
    state.sidebarActiveSectionCollapsed = savedActiveSectionCollapsed === 'true'
  }

  const savedWakeLock = localStorage.getItem(STORAGE_KEY_WAKE_LOCK)
  if (savedWakeLock !== null) {
    state.wakeLock = savedWakeLock === 'true'
  }

  const savedTerminalCopyOnSelect = localStorage.getItem(STORAGE_KEY_TERMINAL_COPY_ON_SELECT)
  if (savedTerminalCopyOnSelect !== null) {
    state.terminalCopyOnSelect = savedTerminalCopyOnSelect === 'true'
  }

  const savedTerminalRightClickPaste = localStorage.getItem(STORAGE_KEY_TERMINAL_RIGHT_CLICK_PASTE)
  if (savedTerminalRightClickPaste !== null) {
    state.terminalRightClickPaste = savedTerminalRightClickPaste === 'true'
  }

  // 右侧面板宽度
  const savedWidth = localStorage.getItem(STORAGE_KEY_RIGHT_PANEL_WIDTH)
  if (savedWidth) {
    const width = parseInt(savedWidth)
    if (!isNaN(width) && width >= 160 && width <= MAX_RIGHT_PANEL_WIDTH) {
      state.rightPanelWidth = width
    }
  }

  // 底部面板高度
  const savedBottomHeight = localStorage.getItem(STORAGE_KEY_BOTTOM_PANEL_HEIGHT)
  if (savedBottomHeight) {
    const height = parseInt(savedBottomHeight)
    if (!isNaN(height) && height >= 100 && height <= 500) {
      state.bottomPanelHeight = height
    }
  }

  const savedPanelLayout = localStorage.getItem(STORAGE_KEY_PANEL_LAYOUT)
  if (savedPanelLayout) {
    const restored = sanitizePersistedPanelLayout(JSON.parse(savedPanelLayout))
    if (restored) {
      state.panelTabs = restored.panelTabs.map(normalizePersistedPanelTab)
      state.activeTabId = { ...restored.activeTabId }
      state.rightPanelOpen = restored.rightPanelOpen
      state.bottomPanelOpen = restored.bottomPanelOpen
    }
  }
}
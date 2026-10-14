// ============================================
// LayoutStore - Settings slice
// 侧边栏 / 屏幕常亮 / 终端交互偏好
// ============================================
import type { LayoutStore } from './layoutStore'

export interface SettingsSlice {
  getSidebarExpanded(): boolean
  setSidebarExpanded(expanded: boolean): void
  setSidebarFolderRecents(enabled: boolean): void
  setSidebarFolderRecentsShowDiff(enabled: boolean): void
  setSidebarShowChildSessions(enabled: boolean): void
  setSidebarActiveSectionCollapsed(collapsed: boolean): void
  setWakeLock(enabled: boolean): void
  setTerminalCopyOnSelect(enabled: boolean): void
  setTerminalRightClickPaste(enabled: boolean): void
  toggleSidebar(): void
}

export const settingsMethods: SettingsSlice & ThisType<LayoutStore> = {
  getSidebarExpanded() {
    return this.state.sidebarExpanded
  },

  setSidebarExpanded(expanded) {
    if (this.state.sidebarExpanded === expanded) return
    this.state.sidebarExpanded = expanded
    try {
      localStorage.setItem('opencode-sidebar-expanded', String(expanded))
    } catch {
      // ignore
    }
    this.notify()
  },

  setSidebarFolderRecents(enabled) {
    if (this.state.sidebarFolderRecents === enabled) return
    this.state.sidebarFolderRecents = enabled
    try {
      localStorage.setItem('opencode-sidebar-folder-recents', String(enabled))
    } catch {
      // ignore
    }
    this.notify()
  },

  setSidebarFolderRecentsShowDiff(enabled) {
    if (this.state.sidebarFolderRecentsShowDiff === enabled) return
    this.state.sidebarFolderRecentsShowDiff = enabled
    try {
      localStorage.setItem('opencode-sidebar-folder-recents-show-diff', String(enabled))
    } catch {
      // ignore
    }
    this.notify()
  },

  setSidebarShowChildSessions(enabled) {
    if (this.state.sidebarShowChildSessions === enabled) return
    this.state.sidebarShowChildSessions = enabled
    try {
      localStorage.setItem('opencode-sidebar-show-child-sessions', String(enabled))
    } catch {
      /* ignore */
    }
    this.notify()
  },

  setSidebarActiveSectionCollapsed(collapsed) {
    if (this.state.sidebarActiveSectionCollapsed === collapsed) return
    this.state.sidebarActiveSectionCollapsed = collapsed
    try {
      localStorage.setItem('opencode-sidebar-active-section-collapsed', String(collapsed))
    } catch {
      /* ignore */
    }
    this.notify()
  },

  setWakeLock(enabled) {
    if (this.state.wakeLock === enabled) return
    this.state.wakeLock = enabled
    try {
      localStorage.setItem('opencode-wake-lock', String(enabled))
    } catch {
      /* ignore */
    }
    this.notify()
  },

  setTerminalCopyOnSelect(enabled) {
    if (this.state.terminalCopyOnSelect === enabled) return
    this.state.terminalCopyOnSelect = enabled
    try {
      localStorage.setItem('opencode-terminal-copy-on-select', String(enabled))
    } catch {
      /* ignore */
    }
    this.notify()
  },

  setTerminalRightClickPaste(enabled) {
    if (this.state.terminalRightClickPaste === enabled) return
    this.state.terminalRightClickPaste = enabled
    try {
      localStorage.setItem('opencode-terminal-right-click-paste', String(enabled))
    } catch {
      /* ignore */
    }
    this.notify()
  },

  toggleSidebar() {
    this.setSidebarExpanded(!this.state.sidebarExpanded)
  },
}
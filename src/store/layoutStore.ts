// ============================================
// LayoutStore - 全局 UI 布局状态（内核）
// ============================================
//
// 本文件只保留共享状态骨架（state / 订阅 / notify / getState）与模块级 API；
// 各职责方法按 slice 拆分到同目录文件，通过 prototype 混入：
//   - layoutStore.panels.ts      统一面板标签系统 + 右侧/底部面板
//   - layoutStore.files.ts       文件预览标签
//   - layoutStore.terminal.ts    终端标签 + 按目录布局同步
//   - layoutStore.settings.ts    侧边栏 / 屏幕常亮 / 终端交互偏好
//   - layoutStore.persistence.ts 布局持久化与启动恢复
// slice 之间不互相 import；共享类型见 layoutStore.types.ts，纯函数见 layoutStore.utils.ts。
import { useSyncExternalStore } from 'react'
import type { LayoutBackup, LayoutSnapshot, LayoutState, PersistedTerminalLayoutMap, Subscriber } from './layoutStore.types'
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
  STORAGE_KEY_TERMINAL_LAYOUT,
  STORAGE_KEY_VIEWPORT_SIDEBAR_WIDTH,
  STORAGE_KEY_WAKE_LOCK,
  buildPersistedPanelLayout,
  sanitizePersistedPanelLayout,
  sanitizePersistedTerminalLayoutMap,
} from './layoutStore.utils'
import { panelMethods, type PanelSlice } from './layoutStore.panels'
import { fileMethods, type FileSlice } from './layoutStore.files'
import { terminalMethods, type TerminalSlice } from './layoutStore.terminal'
import { settingsMethods, type SettingsSlice } from './layoutStore.settings'
import { persistenceMethods, restoreLayoutState, type PersistenceSlice } from './layoutStore.persistence'

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

export interface LayoutStore
  extends PanelSlice,
    FileSlice,
    TerminalSlice,
    SettingsSlice,
    PersistenceSlice {}

export class LayoutStore {
  state: LayoutState = {
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
    sidebarActiveSectionCollapsed: false,
    rightPanelOpen: false,
    rightPanelWidth: 450,
    bottomPanelOpen: false,
    bottomPanelHeight: 250,
    wakeLock: false,
    terminalCopyOnSelect: false,
    terminalRightClickPaste: false,
  }
  subscribers = new Set<Subscriber>()
  currentTerminalLayoutKey: string | null = null
  rightPanelAutoOpenDismissed = false

  constructor() {
    // 从 localStorage 恢复状态
    try {
      restoreLayoutState(this.state)
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

  notify() {
    this.persistPanelLayout()
    this.persistTerminalLayout()
    this.subscribers.forEach(fn => fn())
  }

  getState() {
    return this.state
  }
}

Object.defineProperties(LayoutStore.prototype, Object.getOwnPropertyDescriptors(panelMethods))
Object.defineProperties(LayoutStore.prototype, Object.getOwnPropertyDescriptors(fileMethods))
Object.defineProperties(LayoutStore.prototype, Object.getOwnPropertyDescriptors(terminalMethods))
Object.defineProperties(LayoutStore.prototype, Object.getOwnPropertyDescriptors(settingsMethods))
Object.defineProperties(LayoutStore.prototype, Object.getOwnPropertyDescriptors(persistenceMethods))

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
    sidebarActiveSectionCollapsed: state.sidebarActiveSectionCollapsed,
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
  localStorage.setItem(
    STORAGE_KEY_SIDEBAR_ACTIVE_SECTION_COLLAPSED,
    String(parsed?.sidebarActiveSectionCollapsed === true),
  )
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
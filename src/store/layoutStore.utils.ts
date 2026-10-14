import type {
  LayoutState,
  PanelPosition,
  PanelTab,
  PersistedPanelLayout,
  PersistedPanelTab,
  PersistedPanelTabType,
  PersistedTerminalDirectoryLayout,
  PersistedTerminalLayoutMap,
  PersistedTerminalSessionState,
  TerminalTab,
} from './layoutStore.types'

// ============================================
// LayoutStore - 纯常量
// ============================================

export const MAX_RIGHT_PANEL_WIDTH = 1280

export const STORAGE_KEY_WAKE_LOCK = 'opencode-wake-lock'
export const STORAGE_KEY_SIDEBAR = 'opencode-sidebar-expanded'
export const STORAGE_KEY_SIDEBAR_FOLDER_RECENTS = 'opencode-sidebar-folder-recents'
export const STORAGE_KEY_SIDEBAR_FOLDER_RECENTS_SHOW_DIFF = 'opencode-sidebar-folder-recents-show-diff'
export const STORAGE_KEY_SIDEBAR_SHOW_CHILD_SESSIONS = 'opencode-sidebar-show-child-sessions'
export const STORAGE_KEY_SIDEBAR_ACTIVE_SECTION_COLLAPSED = 'opencode-sidebar-active-section-collapsed'
export const STORAGE_KEY_PANEL_LAYOUT = 'opencode-panel-layout'
export const STORAGE_KEY_TERMINAL_LAYOUT = 'opencode-terminal-layout'
export const STORAGE_KEY_RIGHT_PANEL_WIDTH = 'opencode-right-panel-width'
export const STORAGE_KEY_BOTTOM_PANEL_HEIGHT = 'opencode-bottom-panel-height'
export const STORAGE_KEY_VIEWPORT_SIDEBAR_WIDTH = 'sidebar-width'
export const STORAGE_KEY_TERMINAL_COPY_ON_SELECT = 'opencode-terminal-copy-on-select'
export const STORAGE_KEY_TERMINAL_RIGHT_CLICK_PASTE = 'opencode-terminal-right-click-paste'

export const PANEL_POSITIONS: PanelPosition[] = ['bottom', 'right']
export const PERSISTED_PANEL_TAB_TYPES: PersistedPanelTabType[] = [
  'status',
  'files',
  'changes',
  'mcp',
  'skill',
  'worktree',
  'graph',
]

// ============================================
// LayoutStore - 纯函数
// ============================================

export function getResolvedTerminalTitle(tab: Pick<PanelTab, 'title' | 'shellTitle' | 'customTitle'>): string {
  return tab.customTitle ?? tab.title ?? tab.shellTitle ?? 'Terminal'
}

export function getTerminalIdentity(tab: Pick<TerminalTab, 'id' | 'scopeKey'>): string {
  return `${tab.scopeKey ?? ''}\u0000${tab.id}`
}

export function getTerminalStorageKey(tab: Pick<TerminalTab, 'id' | 'scopeKey'>): string {
  return tab.scopeKey ? getTerminalIdentity(tab) : tab.id
}

export function getPanelTerminalStorageKey(tab: Pick<PanelTab, 'id' | 'ptyId' | 'scopeKey'>): string {
  return getTerminalStorageKey({ id: tab.ptyId ?? tab.id, scopeKey: tab.scopeKey })
}

export function buildTerminalPanelTab(
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

export function isPanelPosition(value: unknown): value is PanelPosition {
  return typeof value === 'string' && PANEL_POSITIONS.includes(value as PanelPosition)
}

export function isPersistedPanelTabType(value: unknown): value is PersistedPanelTabType {
  return typeof value === 'string' && PERSISTED_PANEL_TAB_TYPES.includes(value as PersistedPanelTabType)
}

export function normalizePersistedPanelTab(tab: PersistedPanelTab): PanelTab {
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

export function sanitizePersistedPanelLayout(raw: unknown): PersistedPanelLayout | null {
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

export function sanitizePersistedTerminalLayoutMap(raw: unknown): PersistedTerminalLayoutMap {
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

export function buildPersistedPanelLayout(state: LayoutState): PersistedPanelLayout {
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
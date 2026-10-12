// ============================================
// LayoutStore - 类型定义
// ============================================

// 面板位置
export type PanelPosition = 'bottom' | 'right'

// 面板内容类型
export type PanelTabType = 'status' | 'terminal' | 'files' | 'changes' | 'mcp' | 'skill' | 'worktree' | 'graph'
export type PersistedPanelTabType = Exclude<PanelTabType, 'terminal'>

// 文件预览的文件信息
export interface PreviewFile {
  path: string
  name: string
  targetLine?: number
  targetKey?: string
  targetRanges?: Array<{ from: number; to: number }>
}

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

// 旧的 RightPanelView 类型 - 兼容
export type RightPanelView = 'status' | 'files' | 'changes'

export interface LayoutState {
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

export type Subscriber = () => void

export interface PersistedPanelTab {
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

export interface PersistedTerminalSessionState {
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

// 兼容的 snapshot 类型，包含派生属性
export interface LayoutSnapshot extends LayoutState {
  // 派生属性 - 兼容旧组件
  rightPanelView: RightPanelView
  terminalTabs: TerminalTab[]
  activeTerminalId: string | null
}
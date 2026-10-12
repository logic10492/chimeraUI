import type { Session as ApiSession } from '../../types/api/session'

export interface SessionListProps {
  sessions: ApiSession[]
  selectedId: string | null
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  search: string
  onSearchChange: (search: string) => void
  onSelect: (session: ApiSession) => void
  onDelete: (sessionId: string) => void
  onRename: (sessionId: string, newTitle: string) => void
  onArchive?: (sessionId: string) => void
  onRestore?: (sessionId: string) => void
  error?: Error | null
  onLoadMore: () => void
  onNewChat: () => void
  showHeader?: boolean
  grouped?: boolean
  density?: 'default' | 'compact' | 'minimal'
  showStats?: boolean
  showDirectory?: boolean
  /** 拉 /children 全量展示的父 session ID */
  expandedChildSessionIds?: Set<string>
  /** 按父 ID 分组的直接挂出来的子 session */
  inlineChildSessions?: Map<string, ApiSession[]>
  onSelectChildSession?: (session: ApiSession) => void
  pinnedDividerAfterIds?: Set<string>
  // ---- 编辑模式 ----
  isEditMode?: boolean
  selectedSessionIds?: Set<string>
  onToggleSessionSelection?: (sessionId: string, options?: { shiftKey?: boolean }) => void
}

// 时间分组类型
export type TimeGroup = 'today' | 'yesterday' | 'previous7Days' | 'previous30Days' | 'older'

export interface SessionListItemProps {
  session: ApiSession
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (newTitle: string) => void
  onArchive?: () => void
  onRestore?: () => void
  preferTouchUi: boolean
  density?: 'default' | 'compact' | 'minimal'
  showStats?: boolean
  showDirectory?: boolean
  // ---- 编辑模式 ----
  isEditMode?: boolean
  isChecked?: boolean
  onToggleCheck?: (options?: { shiftKey?: boolean }) => void
}
import type { Session as ApiSession } from '../../../types/api/session'

export interface SidePanelProps {
  onNewSession: () => void
  onSelectSession: (session: ApiSession) => void
  onCloseMobile?: () => void
  selectedSessionId: string | null
  onAddProject: () => void
  isMobile?: boolean
  isExpanded?: boolean
  onToggleSidebar: () => void
  onOpenSettings?: () => void
}

export interface ProjectItem {
  id: string
  worktree: string
  name: string
  canReorder?: boolean
  memberDirectories?: string[]
  reorderPath?: string
  workspaceDirectories?: string[]
  sectionKind?: 'project' | 'workspace'
}
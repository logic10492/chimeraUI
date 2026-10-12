export interface ChatPaneProps {
  paneId: string
  sessionId: string | null
  isFocused: boolean
  paneCount: number
  displayMode: 'single' | 'split'
  isPaneFullscreen?: boolean
  onOpenSidebar?: () => void
  onToggleRightPanel?: () => void
  onOpenSettings?: () => void
  showSidebarButton?: boolean
  onSplitPane?: () => void
  onTogglePaneFullscreen?: () => void
  navigatePaneToSession: (paneId: string, sessionId: string, directory?: string) => void
  navigatePaneHome: (paneId: string) => void
}
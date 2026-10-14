/**
 * ActiveSessionsSection - Recents tab 顶部的置顶活跃会话区。
 *
 * 批次A 侧边栏合并改造：busy 会话不再单独占一个 tab，
 * 而是常驻在最近列表上方，可折叠（折叠态持久化到 layoutStore）。
 * 每条会话显示所属项目 chip（folderProjects 分组名，兜底目录 basename）。
 */

import { useTranslation } from 'react-i18next'
import type { ActiveSessionEntry } from '../../../store/activeSessionStore'
import type { Session as ApiSession } from '../../../types/api/session'
import { layoutStore, useLayoutStore } from '../../../store/layoutStore'
import { ChevronDownIcon } from '../../../components/Icons'
import { getDirectoryName, normalizeToForwardSlash } from '../../../utils'
import { findProjectGroupForDirectory } from './SidePanel.utils'
import type { ProjectItem } from './SidePanel.types'
import { ActiveSessionItem } from './ActiveSessionItem'
import type { ActiveSessionTree } from './activeSessionTree'

interface ActiveSessionsSectionProps {
  busySessions: ActiveSessionEntry[]
  activeSessionTree: ActiveSessionTree
  sessionLookup: Map<string, ApiSession>
  selectedSessionId: string | null
  onSelect: (session: ApiSession) => void
  folderProjects: ProjectItem[]
}

export function ActiveSessionsSection({
  busySessions,
  activeSessionTree,
  sessionLookup,
  selectedSessionId,
  onSelect,
  folderProjects,
}: ActiveSessionsSectionProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { sidebarActiveSectionCollapsed } = useLayoutStore()

  if (busySessions.length === 0) return null

  const needsAttention = busySessions.some(
    entry =>
      entry.pendingAction?.type === 'permission' ||
      entry.pendingAction?.type === 'question' ||
      entry.status.type === 'retry',
  )

  const getProjectLabel = (entry: ActiveSessionEntry) => {
    const directory = entry.directory || sessionLookup.get(entry.sessionId)?.directory
    if (!directory) return undefined
    const normalized = normalizeToForwardSlash(directory)
    return findProjectGroupForDirectory(folderProjects, normalized)?.name || getDirectoryName(normalized)
  }

  // Busy sessions — 子 session 挂在父下面
  const renderActiveSessionNode = (entry: ActiveSessionEntry, level = 0): React.ReactNode => {
    const resolvedSession = sessionLookup.get(entry.sessionId)
    const childEntries = activeSessionTree.childrenByParent.get(entry.sessionId) ?? []

    return (
      <div key={entry.sessionId} style={level > 0 ? { marginLeft: level * 12 } : undefined}>
        <ActiveSessionItem
          entry={entry}
          resolvedSession={resolvedSession}
          isSelected={entry.sessionId === selectedSessionId}
          onSelect={onSelect}
          projectLabel={getProjectLabel(entry)}
        />
        {childEntries.map(childEntry => renderActiveSessionNode(childEntry, level + 1))}
      </div>
    )
  }

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => layoutStore.setSidebarActiveSectionCollapsed(!sidebarActiveSectionCollapsed)}
        aria-expanded={!sidebarActiveSectionCollapsed}
        aria-label={
          sidebarActiveSectionCollapsed ? t('sidebar.expandActiveSection') : t('sidebar.collapseActiveSection')
        }
        className="w-full flex items-center gap-1 pl-[6px] pr-2 py-1.5 text-text-500 hover:text-text-300 transition-colors duration-150"
      >
        <ChevronDownIcon
          size={14}
          className={`shrink-0 text-text-400 transition-transform duration-200 ${sidebarActiveSectionCollapsed ? '-rotate-90' : ''}`}
        />
        <span className="text-[length:var(--fs-xxs)] font-semibold uppercase tracking-wider">
          {t('sidebar.active')}
        </span>
        <span
          className={`inline-flex h-[15px] min-w-[15px] shrink-0 items-center justify-center rounded-full px-1 text-[length:var(--fs-xxs)] font-medium leading-none transition-colors ${
            needsAttention ? 'bg-warning-100/10 text-warning-100' : 'bg-success-100/10 text-success-100'
          }`}
        >
          {busySessions.length}
        </span>
      </button>
      {!sidebarActiveSectionCollapsed && (
        <div className="max-h-[35vh] overflow-y-auto custom-scrollbar px-2">
          {activeSessionTree.rootEntries.map(entry => renderActiveSessionNode(entry))}
        </div>
      )}
      <div className="mx-3 h-px bg-border-200/45" />
    </div>
  )
}

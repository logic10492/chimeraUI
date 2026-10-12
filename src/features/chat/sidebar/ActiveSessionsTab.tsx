/**
 * ActiveSessionsTab - SidePanel "Active" 标签页内容。
 *
 * 拆自 SidePanel.tsx（批次 ④）。原 renderActiveSessionNode 是读父级闭包的
 * 渲染函数，现改为组件内本地函数；busy/notification 数据与选中态、选择回调
 * 均经显式 props 传入。
 */

import { useTranslation } from 'react-i18next'
import type { ActiveSessionEntry } from '../../../store/activeSessionStore'
import type { Session as ApiSession } from '../../../types/api/session'
import type { NotificationEntry } from '../../../store/notificationStore'
import { notificationStore } from '../../../store/notificationStore'
import { ActiveSessionItem } from './ActiveSessionItem'
import { NotificationItem } from './NotificationItem'
import type { ActiveSessionTree } from './activeSessionTree'

interface ActiveSessionsTabProps {
  busySessions: ActiveSessionEntry[]
  notifications: NotificationEntry[]
  sessionLookup: Map<string, ApiSession>
  activeSessionTree: ActiveSessionTree
  selectedSessionId: string | null
  onSelect: (session: ApiSession) => void
}

export function ActiveSessionsTab({
  busySessions,
  notifications,
  sessionLookup,
  activeSessionTree,
  selectedSessionId,
  onSelect,
}: ActiveSessionsTabProps) {
  const { t } = useTranslation(['chat', 'common'])

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
        />
        {childEntries.map(childEntry => renderActiveSessionNode(childEntry, level + 1))}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3">
      {busySessions.length === 0 && notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-400 opacity-60">
          <p className="text-[length:var(--fs-sm)]">{t('sidebar.noActiveSessions')}</p>
        </div>
      ) : (
        <div className="mt-1 space-y-0.5">
          {activeSessionTree.rootEntries.map(entry => renderActiveSessionNode(entry))}

          {/* Divider + actions between busy and notifications */}
          {notifications.length > 0 && (
            <div
              className={`flex items-center justify-between gap-2 ${busySessions.length > 0 ? 'mt-2 pt-2 border-t border-border-200/30' : ''}`}
            >
              <span className="text-[length:var(--fs-xxs)] font-medium text-text-400 uppercase tracking-wider pl-[6px]">
                {t('sidebar.notifications')}
              </span>
              <div className="flex items-center gap-0.5">
                {notifications.some(n => !n.read) && (
                  <button
                    className="text-[length:var(--fs-xxs)] text-text-400 hover:text-text-200 px-1.5 py-0.5 rounded-md hover:bg-bg-200 transition-all duration-150 active:scale-95"
                    onClick={() => notificationStore.markAllRead()}
                  >
                    {t('sidebar.readAll')}
                  </button>
                )}
                <button
                  className="text-[length:var(--fs-xxs)] text-text-400 hover:text-text-200 px-1.5 py-0.5 rounded-md hover:bg-bg-200 transition-all duration-150 active:scale-95"
                  onClick={() => notificationStore.clearAll()}
                >
                  {t('common:clear')}
                </button>
              </div>
            </div>
          )}

          {/* Notification history */}
          {notifications.map(entry => {
            const resolvedSession = sessionLookup.get(entry.sessionId)
            return <NotificationItem key={entry.id} entry={entry} resolvedSession={resolvedSession} onSelect={onSelect} />
          })}
        </div>
      )}
    </div>
  )
}
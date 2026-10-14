/**
 * NotificationsTab - SidePanel「通知」标签页内容。
 *
 * 批次A 侧边栏合并改造：原 ActiveSessionsTab 的通知区独立成 tab；
 * 活跃（busy）会话改由 Recents tab 顶部的 ActiveSessionsSection 展示。
 */

import { useTranslation } from 'react-i18next'
import type { Session as ApiSession } from '../../../types/api/session'
import type { NotificationEntry } from '../../../store/notificationStore'
import { notificationStore } from '../../../store/notificationStore'
import { NotificationItem } from './NotificationItem'

interface NotificationsTabProps {
  notifications: NotificationEntry[]
  sessionLookup: Map<string, ApiSession>
  selectedSessionId: string | null
  onSelect: (session: ApiSession) => void
}

export function NotificationsTab({ notifications, sessionLookup, onSelect }: NotificationsTabProps) {
  const { t } = useTranslation(['chat', 'common'])

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3">
      <div className="mt-1 space-y-0.5">
        {/* Actions header — 常驻显示 */}
        <div className="flex items-center justify-between gap-2">
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

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-400 opacity-60">
            <p className="text-[length:var(--fs-sm)]">{t('sidebar.noNotifications')}</p>
          </div>
        ) : (
          notifications.map(entry => (
            <NotificationItem
              key={entry.id}
              entry={entry}
              resolvedSession={sessionLookup.get(entry.sessionId)}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}

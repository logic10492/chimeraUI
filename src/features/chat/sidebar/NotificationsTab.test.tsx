import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NotificationsTab } from './NotificationsTab'
import { notificationStore } from '../../../store/notificationStore'
import type { NotificationEntry } from '../../../store/notificationStore'
import type { Session as ApiSession } from '../../../types/api/session'
import i18n from '../../../i18n'

function notification(overrides: Partial<NotificationEntry> = {}): NotificationEntry {
  return {
    id: 'n1',
    type: 'completed',
    title: 'Notif One',
    body: '',
    sessionId: 'notif-session',
    serverID: 'local',
    timestamp: Date.now(),
    read: false,
    ...overrides,
  }
}

function renderTab(overrides: {
  notifications?: NotificationEntry[]
  sessionLookup?: Map<string, ApiSession>
  selectedSessionId?: string | null
  onSelect?: (s: ApiSession) => void
} = {}) {
  return render(
    <NotificationsTab
      notifications={overrides.notifications ?? []}
      sessionLookup={overrides.sessionLookup ?? new Map()}
      selectedSessionId={overrides.selectedSessionId ?? null}
      onSelect={overrides.onSelect ?? vi.fn()}
    />,
  )
}

describe('NotificationsTab (批次A)', () => {
  it('renders notification entries and marks all read on demand', () => {
    const markAllRead = vi.spyOn(notificationStore, 'markAllRead').mockImplementation(() => {})
    renderTab({ notifications: [notification()] })

    expect(screen.getByText('Notif One')).toBeInTheDocument()

    fireEvent.click(screen.getByText(i18n.t('sidebar.readAll', { ns: 'chat' })))
    expect(markAllRead).toHaveBeenCalledTimes(1)
    markAllRead.mockRestore()
  })

  it('clears all notifications on demand', () => {
    const clearAll = vi.spyOn(notificationStore, 'clearAll').mockImplementation(() => {})
    renderTab({ notifications: [notification()] })

    fireEvent.click(screen.getByText(i18n.t('common:clear')))
    expect(clearAll).toHaveBeenCalledTimes(1)
    clearAll.mockRestore()
  })

  it('shows the empty state when there are no notifications', () => {
    renderTab({ notifications: [] })

    expect(screen.getByText(i18n.t('sidebar.noNotifications', { ns: 'chat' }))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('sidebar.readAll', { ns: 'chat' }))).toBeNull()
  })
})

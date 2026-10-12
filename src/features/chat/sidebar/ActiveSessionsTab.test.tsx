import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActiveSessionsTab } from './ActiveSessionsTab'
import { notificationStore } from '../../../store/notificationStore'
import type { ActiveSessionEntry } from '../../../store/activeSessionStore'
import type { NotificationEntry } from '../../../store/notificationStore'
import type { Session as ApiSession } from '../../../types/api/session'
import type { ActiveSessionTree } from './activeSessionTree'
import i18n from '../../../i18n'

function busy(sessionId: string): ActiveSessionEntry {
  return { sessionId, status: { type: 'working' } } as ActiveSessionEntry
}

function session(id: string, title: string): ApiSession {
  return { id, title } as unknown as ApiSession
}

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
  busySessions?: ActiveSessionEntry[]
  notifications?: NotificationEntry[]
  sessionLookup?: Map<string, ApiSession>
  activeSessionTree?: ActiveSessionTree
  selectedSessionId?: string | null
  onSelect?: (s: ApiSession) => void
} = {}) {
  const root = busy('root-1')
  const child = busy('child-1')
  return render(
    <ActiveSessionsTab
      busySessions={overrides.busySessions ?? [root, child]}
      notifications={overrides.notifications ?? []}
      sessionLookup={overrides.sessionLookup ?? new Map([['root-1', session('root-1', 'Root Session')], ['child-1', session('child-1', 'Child Session')]])}
      activeSessionTree={overrides.activeSessionTree ?? { rootEntries: [root], childrenByParent: new Map([['root-1', [child]]]) }}
      selectedSessionId={overrides.selectedSessionId ?? null}
      onSelect={overrides.onSelect ?? vi.fn()}
    />,
  )
}

describe('ActiveSessionsTab (batch ④)', () => {
  it('renders the busy session tree including nested child sessions', () => {
    renderTab()

    expect(screen.getByText('Root Session')).toBeInTheDocument()
    expect(screen.getByText('Child Session')).toBeInTheDocument()
  })

  it('shows the empty state when there are no busy sessions or notifications', () => {
    renderTab({ busySessions: [], notifications: [], activeSessionTree: { rootEntries: [], childrenByParent: new Map() } })

    expect(screen.getByText(i18n.t('sidebar.noActiveSessions', { ns: 'chat' }))).toBeInTheDocument()
    expect(screen.queryByText('Root Session')).toBeNull()
  })

  it('renders notification entries and marks all read on demand', () => {
    const markAllRead = vi.spyOn(notificationStore, 'markAllRead').mockImplementation(() => {})
    renderTab({ notifications: [notification()] })

    expect(screen.getByText('Notif One')).toBeInTheDocument()

    fireEvent.click(screen.getByText(i18n.t('sidebar.readAll', { ns: 'chat' })))
    expect(markAllRead).toHaveBeenCalledTimes(1)
    markAllRead.mockRestore()
  })
})
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ActiveSessionsSection } from './ActiveSessionsSection'
import { layoutStore } from '../../../store/layoutStore'
import type { ActiveSessionEntry } from '../../../store/activeSessionStore'
import type { Session as ApiSession } from '../../../types/api/session'
import i18n from '../../../i18n'

function busy(sessionId: string, directory?: string): ActiveSessionEntry {
  return { sessionId, status: { type: 'working' }, directory } as ActiveSessionEntry
}

function session(id: string, title: string, directory?: string): ApiSession {
  return { id, title, directory } as unknown as ApiSession
}

function renderSection(overrides: {
  busySessions?: ActiveSessionEntry[]
  sessionLookup?: Map<string, ApiSession>
  selectedSessionId?: string | null
  onSelect?: (s: ApiSession) => void
} = {}) {
  const root = busy('root-1', '/workspace/root-project')
  const child = busy('child-1')
  const busySessions = overrides.busySessions ?? [root, child]
  return render(
    <ActiveSessionsSection
      busySessions={busySessions}
      activeSessionTree={{ rootEntries: [root], childrenByParent: new Map([['root-1', [child]]]) }}
      sessionLookup={
        overrides.sessionLookup ??
        new Map([
          ['root-1', session('root-1', 'Root Session', '/workspace/root-project')],
          ['child-1', session('child-1', 'Child Session')],
        ])
      }
      selectedSessionId={overrides.selectedSessionId ?? null}
      onSelect={overrides.onSelect ?? vi.fn()}
      folderProjects={[{ id: '/workspace/root-project', worktree: '/workspace/root-project', name: 'Root Project' }]}
    />,
  )
}

describe('ActiveSessionsSection (批次A)', () => {
  beforeEach(() => {
    localStorage.clear()
    layoutStore.setSidebarActiveSectionCollapsed(false)
  })

  it('renders nothing when there are no busy sessions', () => {
    const { container } = renderSection({ busySessions: [] })

    expect(container.firstChild).toBeNull()
  })

  it('renders busy session entries with a count badge', () => {
    renderSection()

    expect(screen.getByText('Root Session')).toBeInTheDocument()
    expect(screen.getByText('Child Session')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('collapses and expands the body when the header is clicked, persisting to layoutStore', () => {
    renderSection()

    const header = screen.getByRole('button', {
      name: i18n.t('sidebar.collapseActiveSection', { ns: 'chat' }),
    })

    fireEvent.click(header)

    expect(screen.queryByText('Root Session')).toBeNull()
    expect(layoutStore.getState().sidebarActiveSectionCollapsed).toBe(true)
    expect(localStorage.getItem('opencode-sidebar-active-section-collapsed')).toBe('true')

    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('sidebar.expandActiveSection', { ns: 'chat' }),
      }),
    )

    expect(screen.getByText('Root Session')).toBeInTheDocument()
    expect(layoutStore.getState().sidebarActiveSectionCollapsed).toBe(false)
  })

  it('indents nested child sessions in the tree', () => {
    renderSection()

    const childWrapper = screen.getByText('Child Session').closest('div[style]')

    expect(childWrapper?.style.marginLeft).toBe('12px')
  })

  it('always renders the bottom divider', () => {
    const { container } = renderSection()

    expect(container.querySelector('[class*="bg-border-200"]')).not.toBeNull()

    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('sidebar.collapseActiveSection', { ns: 'chat' }),
      }),
    )

    expect(container.querySelector('[class*="bg-border-200"]')).not.toBeNull()
  })
})

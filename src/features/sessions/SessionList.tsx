import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchIcon, ComposeIcon } from '../../components/Icons'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useInputCapabilities } from '../../hooks/useInputCapabilities'
import { SessionChildrenSlot } from '../chat/sidebar/SessionChildrenSlot'
import type { Session as ApiSession } from '../../types/api/session'
import type { SessionListProps, TimeGroup } from './SessionList.types'
import { SESSION_GROUP_ORDER } from './SessionList.utils'
import { SessionListItem } from './SessionListItem'
import { LoadingSpinner } from './SessionListLoadingSpinner'

export { SessionListItem } from './SessionListItem'
export type { SessionListItemProps } from './SessionList.types'

export function SessionList({
  sessions,
  selectedId,
  isLoading,
  isLoadingMore,
  hasMore,
  search,
  onSearchChange,
  onSelect,
  onDelete,
  onRename,
  onArchive,
  onRestore,
  error,
  onLoadMore,
  onNewChat,
  showHeader = true,
  grouped = true,
  density = 'default',
  showStats = true,
  showDirectory = false,
  expandedChildSessionIds,
  inlineChildSessions,
  onSelectChildSession,
  pinnedDividerAfterIds,
  isEditMode = false,
  selectedSessionIds,
  onToggleSessionSelection,
}: SessionListProps) {
  const { t } = useTranslation(['commands', 'common', 'chat'])
  const { preferTouchUi } = useInputCapabilities()
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; sessionId: string | null }>({
    isOpen: false,
    sessionId: null,
  })

  // 滚动加载
  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el || isLoadingMore || !hasMore) return

    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight - scrollTop - clientHeight < 100) {
      onLoadMore()
    }
  }, [isLoadingMore, hasMore, onLoadMore])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // 分组逻辑
  const groupedSessions = useMemo(() => {
    const groups: Record<TimeGroup, ApiSession[]> = {
      today: [],
      yesterday: [],
      previous7Days: [],
      previous30Days: [],
      older: [],
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterday = today - 86400000
    const weekAgo = today - 86400000 * 7
    const monthAgo = today - 86400000 * 30

    sessions.forEach(session => {
      const updated = session.time.updated ?? session.time.created
      if (updated >= today) {
        groups.today.push(session)
      } else if (updated >= yesterday) {
        groups.yesterday.push(session)
      } else if (updated >= weekAgo) {
        groups.previous7Days.push(session)
      } else if (updated >= monthAgo) {
        groups.previous30Days.push(session)
      } else {
        groups.older.push(session)
      }
    })

    return groups
  }, [sessions])

  const isCompact = density === 'compact'

  // 只有非搜索状态才显示分组
  const showGroups = !search && grouped

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar + New Chat */}
      {showHeader && (
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative group flex-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-400 w-3.5 h-3.5 group-focus-within:text-accent-main-100 transition-colors" />
              <input
                ref={searchInputRef}
                type="text"
                name="session-search"
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={t('sessions.searchChats')}
                aria-label={t('sessions.searchChats')}
                autoComplete="off"
                className="w-full bg-bg-200/40 hover:bg-bg-200/80 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-lg py-2 pl-9 pr-3 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400/70 focus:outline-none focus:shadow-sm transition-all duration-200"
              />
            </div>
            <button
              type="button"
              onClick={onNewChat}
              title={t('sessions.newChat')}
              aria-label={t('sessions.newChat')}
              className="p-2 rounded-lg bg-bg-200/40 hover:bg-bg-200/80 text-text-400 hover:text-text-100 transition-all duration-200"
            >
              <ComposeIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Session List */}
      <div
        ref={listRef}
        className={`flex-1 overflow-y-auto custom-scrollbar px-2 ${isCompact ? 'pb-3 space-y-2' : 'pb-4 space-y-4'}`}
      >
        {isLoading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-400 opacity-60">
            <p className="text-[length:var(--fs-sm)]">
              {search ? t('common:noMatchesFound') : t('sessions.noChatsYet')}
            </p>
          </div>
        ) : showGroups ? (
          // Grouped View
          SESSION_GROUP_ORDER.map(group => {
            const groupSessions = groupedSessions[group]
            if (groupSessions.length === 0) return null
            return (
              <div key={group}>
                <h3 className="px-3 mb-1.5 mt-2 text-[length:var(--fs-xxs)] font-bold text-text-400/60 uppercase tracking-widest select-none">
                  {t(`sessions.groups.${group}`)}
                </h3>
                <div className="space-y-0.5">
                  {groupSessions.map(session => (
                    <div key={session.id}>
                      <SessionListItem
                        session={session}
                        isSelected={session.id === selectedId}
                        onSelect={() => onSelect(session)}
                        onDelete={() => setDeleteConfirm({ isOpen: true, sessionId: session.id })}
                        onArchive={onArchive ? () => onArchive(session.id) : undefined}
                        onRestore={onRestore ? () => onRestore(session.id) : undefined}
                        onRename={newTitle => onRename(session.id, newTitle)}
                        preferTouchUi={preferTouchUi}
                        density={density}
                        showStats={showStats}
                        showDirectory={showDirectory}
                        isEditMode={isEditMode}
                        isChecked={selectedSessionIds?.has(session.id)}
                        onToggleCheck={
                          onToggleSessionSelection
                            ? options => onToggleSessionSelection(session.id, options)
                            : undefined
                        }
                      />
                      {onSelectChildSession &&
                        (expandedChildSessionIds?.has(session.id) || inlineChildSessions?.has(session.id)) && (
                          <SessionChildrenSlot
                            parentSession={session}
                            selectedSessionId={selectedId}
                            fetchAll={expandedChildSessionIds?.has(session.id)}
                            children={inlineChildSessions?.get(session.id)}
                            onSelect={onSelectChildSession}
                            isEditMode={isEditMode}
                            selectedSessionIds={selectedSessionIds}
                            onToggleSessionSelection={onToggleSessionSelection}
                          />
                        )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        ) : (
          // Flat View
          <div className="space-y-0.5 mt-1">
            {sessions.map(session => {
              const inlineChildren = inlineChildSessions?.get(session.id)
              const shouldFetchAll = expandedChildSessionIds?.has(session.id)
              const hasChildren = shouldFetchAll || (inlineChildren && inlineChildren.length > 0)
              const showPinnedDivider = pinnedDividerAfterIds?.has(session.id)
              return (
                <div key={session.id}>
                  <SessionListItem
                    session={session}
                    isSelected={session.id === selectedId}
                    onSelect={() => onSelect(session)}
                    onDelete={() => setDeleteConfirm({ isOpen: true, sessionId: session.id })}
                    onArchive={onArchive ? () => onArchive(session.id) : undefined}
                    onRestore={onRestore ? () => onRestore(session.id) : undefined}
                    onRename={newTitle => onRename(session.id, newTitle)}
                    preferTouchUi={preferTouchUi}
                    density={density}
                    showStats={showStats}
                    showDirectory={showDirectory}
                    isEditMode={isEditMode}
                    isChecked={selectedSessionIds?.has(session.id)}
                    onToggleCheck={
                      onToggleSessionSelection ? options => onToggleSessionSelection(session.id, options) : undefined
                    }
                  />
                  {hasChildren && onSelectChildSession && (
                    <SessionChildrenSlot
                      parentSession={session}
                      selectedSessionId={selectedId}
                      fetchAll={shouldFetchAll}
                      children={inlineChildren}
                      onSelect={onSelectChildSession}
                      isEditMode={isEditMode}
                      selectedSessionIds={selectedSessionIds}
                      onToggleSessionSelection={onToggleSessionSelection}
                    />
                  )}
                  {showPinnedDivider && <div className="mx-3 my-1.5 h-px bg-border-200/45" />}
                </div>
              )
            })}
          </div>
        )}

        {isLoadingMore && (
          <div className="flex items-center justify-center py-2">
            <LoadingSpinner size="sm" />
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mx-3 mb-2 rounded-md bg-danger-bg px-3 py-2 text-[length:var(--fs-xs)] text-danger-100"
        >
          {error.message}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, sessionId: null })}
        onConfirm={() => {
          if (deleteConfirm.sessionId) {
            onDelete(deleteConfirm.sessionId)
          }
          setDeleteConfirm({ isOpen: false, sessionId: null })
        }}
        title={t('chat:sidebar.deleteChat')}
        description={t('chat:sidebar.deleteChatConfirm')}
        confirmText={t('common:delete')}
        variant="danger"
      />
    </div>
  )
}

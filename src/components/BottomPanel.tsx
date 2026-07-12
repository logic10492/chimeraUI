import { lazy, memo, Suspense, useCallback, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TerminalIcon } from './Icons'
import { PanelContainer } from './PanelContainer'
import { layoutStore, useLayoutStore, type TerminalTab, type PanelTab } from '../store/layoutStore'
import { serverStore } from '../store/serverStore'
import { createPtySession, removePtySession, listPtySessions } from '../api/pty'
import { activeApiScope, apiScopeKey, resolveSessionApiScope, type ApiScope } from '../api/scope'
import { useMessageStore } from '../store'
import { ResizablePanel } from './ui/ResizablePanel'
import { logger } from '../utils/logger'
import { normalizeToForwardSlash, uiErrorHandler } from '../utils'
import { useChatViewport } from '../features/chat/chatViewport'

const Terminal = lazy(() => import('./Terminal').then(module => ({ default: module.Terminal })))
const SessionChangesPanel = lazy(() =>
  import('./SessionChangesPanel').then(module => ({ default: module.SessionChangesPanel })),
)
const FileExplorer = lazy(() => import('./FileExplorer').then(module => ({ default: module.FileExplorer })))
const McpPanel = lazy(() => import('./McpPanel').then(module => ({ default: module.McpPanel })))
const SkillPanel = lazy(() => import('./SkillPanel').then(module => ({ default: module.SkillPanel })))
const WorktreePanel = lazy(() => import('./WorktreePanel').then(module => ({ default: module.WorktreePanel })))
const SessionStatusPanel = lazy(() =>
  import('./SessionStatusPanel').then(module => ({ default: module.SessionStatusPanel })),
)
const GraphPanel = lazy(() => import('./GraphPanel').then(module => ({ default: module.GraphPanel })))

interface BottomPanelProps {
  directory?: string
}

function PanelFallback() {
  const { t } = useTranslation(['components', 'common'])
  return (
    <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
      {t('bottomPanel.loadingPanel')}
    </div>
  )
}

export const BottomPanel = memo(function BottomPanel({ directory }: BottomPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { bottomPanelOpen, bottomPanelHeight } = useLayoutStore()
  const { sessionId } = useMessageStore()
  const { interaction, layout } = useChatViewport()

  const [isRestoring, setIsRestoring] = useState(false)
  const normalizedDirectory = directory ? normalizeToForwardSlash(directory) : undefined
  const getTerminalScope = useCallback(() => {
    const activeScope = activeApiScope(normalizedDirectory)
    return sessionId ? resolveSessionApiScope(sessionId, activeScope) : activeScope
  }, [sessionId, normalizedDirectory])

  // 追踪面板 resize 状态
  const [isPanelResizing, setIsPanelResizing] = useState(false)
  useEffect(() => {
    const onStart = () => setIsPanelResizing(true)
    const onEnd = () => setIsPanelResizing(false)
    window.addEventListener('panel-resize-start', onStart)
    window.addEventListener('panel-resize-end', onEnd)
    return () => {
      window.removeEventListener('panel-resize-start', onStart)
      window.removeEventListener('panel-resize-end', onEnd)
    }
  }, [])

  // scope 变化时（包括 server、workspace、directory），重新拉取对应 PTY 会话
  const prevScopeKeyRef = useRef<string | undefined>(undefined)
  const hasRestoredScopeRef = useRef(false)
  const restoreRequestIdRef = useRef(0)
  useEffect(() => {
    const scopeKey = apiScopeKey(getTerminalScope())
    if (hasRestoredScopeRef.current && prevScopeKeyRef.current === scopeKey) return
    hasRestoredScopeRef.current = true
    prevScopeKeyRef.current = scopeKey

    const restoreSessions = async (requestId: number) => {
      const scope = getTerminalScope()
      const scopeKey = apiScopeKey(scope)
      try {
        setIsRestoring(true)

        const sessions = await listPtySessions(scope)
        if (restoreRequestIdRef.current !== requestId) return
        logger.log('[BottomPanel] PTY sessions for scope', scopeKey, ':', sessions)

        layoutStore.syncTerminalSessions(
          normalizedDirectory,
          sessions.map(pty => ({
            id: pty.id,
            scopeKey,
            title: pty.title || 'Terminal',
            status: pty.status === 'running' ? 'connecting' : 'exited',
          })),
          scopeKey,
        )
      } catch (error) {
        uiErrorHandler('restore terminal sessions', error)
      } finally {
        if (restoreRequestIdRef.current === requestId) {
          setIsRestoring(false)
        }
      }
    }

    void restoreSessions(++restoreRequestIdRef.current)
    return serverStore.onServerChange(() => {
      const nextScopeKey = apiScopeKey(getTerminalScope())
      prevScopeKeyRef.current = nextScopeKey
      void restoreSessions(++restoreRequestIdRef.current)
    })
  }, [getTerminalScope, normalizedDirectory])

  // 创建新终端
  const handleNewTerminal = useCallback(async () => {
    try {
      const scope = getTerminalScope()
      logger.log('[BottomPanel] Creating PTY session for scope:', apiScopeKey(scope))
      const pty = await createPtySession({ cwd: normalizedDirectory }, scope)
      logger.log('[BottomPanel] PTY created:', pty)
      const tab: TerminalTab = {
        id: pty.id,
        scopeKey: apiScopeKey(scope),
        title: pty.title || 'Terminal',
        status: 'connecting',
      }
      layoutStore.addTerminalTab(tab)
    } catch (error) {
      uiErrorHandler('create terminal', error)
    }
  }, [getTerminalScope, normalizedDirectory])

  const handleCloseTerminal = useCallback(
    async (ptyId: string) => {
      try {
        await removePtySession(ptyId, getTerminalScope())
      } catch {
        // ignore - may already be closed
      }
    },
    [getTerminalScope],
  )

  // 渲染内容
  const renderContent = useCallback(
    (activeTab: PanelTab | null) => {
      if (isRestoring && (!activeTab || activeTab.type === 'terminal')) {
        return (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-base)] gap-2">
            <TerminalIcon size={24} className="opacity-30 animate-pulse" />
            <span>{t('terminal.restoringSessions')}</span>
          </div>
        )
      }

      if (!activeTab) {
        return (
          <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-base)] gap-2">
            <TerminalIcon size={24} className="opacity-30" />
            <span>{t('common:noContent')}</span>
            <button
              onClick={handleNewTerminal}
              className="px-3 py-1.5 text-[length:var(--fs-sm)] bg-bg-200/50 hover:bg-bg-200 text-text-200 rounded-md transition-colors"
            >
              {t('terminal.createTerminal')}
            </button>
          </div>
        )
      }

      return (
        <>
          {activeTab.type === 'status' ? (
            <Suspense fallback={<PanelFallback />}>
              <SessionStatusPanel
                sessionId={sessionId}
                directory={normalizedDirectory}
                active={activeTab.type === 'status'}
              />
            </Suspense>
          ) : null}

          {/* Keep files mounted so expanded folders and previews survive tab switches. */}
          <div className={activeTab.type === 'files' ? 'h-full' : 'hidden'}>
            <Suspense fallback={<PanelFallback />}>
              <FilesContent
                activeTab={activeTab}
                directory={normalizedDirectory}
                isPanelResizing={isPanelResizing}
                sessionId={sessionId}
              />
            </Suspense>
          </div>

          {activeTab.type === 'changes' ? (
            sessionId ? (
              <Suspense fallback={<PanelFallback />}>
                <ChangesContent
                  activeTab={activeTab}
                  directory={normalizedDirectory}
                  sessionId={sessionId}
                  isPanelResizing={isPanelResizing}
                />
              </Suspense>
            ) : (
              <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
                {t('rightPanel.noActiveSession')}
              </div>
            )
          ) : null}

          {activeTab.type === 'terminal' ? (
            <Suspense fallback={<PanelFallback />}>
              <TerminalContent activeTab={activeTab} apiScope={getTerminalScope()} />
            </Suspense>
          ) : null}

          {activeTab.type === 'mcp' ? (
            <Suspense fallback={<PanelFallback />}>
              <McpPanel isResizing={isPanelResizing} />
            </Suspense>
          ) : null}

          {activeTab.type === 'skill' ? (
            <Suspense fallback={<PanelFallback />}>
              <SkillPanel isResizing={isPanelResizing} />
            </Suspense>
          ) : null}

          {activeTab.type === 'worktree' ? (
            <Suspense fallback={<PanelFallback />}>
              <WorktreePanel isResizing={isPanelResizing} />
            </Suspense>
          ) : null}

          {activeTab.type === 'graph' ? (
            <Suspense fallback={<PanelFallback />}>
              <GraphPanel apiScope={getTerminalScope()} isResizing={isPanelResizing} />
            </Suspense>
          ) : null}
        </>
      )
    },
    [isRestoring, handleNewTerminal, getTerminalScope, normalizedDirectory, sessionId, isPanelResizing, t],
  )

  return (
    <ResizablePanel
      position="bottom"
      isOpen={bottomPanelOpen}
      overlay={interaction.bottomPanelBehavior === 'overlay'}
      overlayBackdrop={false}
      size={bottomPanelHeight}
      maxSize={layout.bottomPanel.maxHeight}
      onSizeChange={h => layoutStore.setBottomPanelHeight(h)}
      onClose={() => layoutStore.closeBottomPanel()}
    >
      <PanelContainer
        position="bottom"
        directory={normalizedDirectory}
        terminalApiScope={getTerminalScope()}
        onNewTerminal={handleNewTerminal}
        onCloseTerminal={handleCloseTerminal}
      >
        {renderContent}
      </PanelContainer>
    </ResizablePanel>
  )
})

// ============================================
// Terminal Content - 渲染所有终端实例
// ============================================

interface TerminalContentProps {
  activeTab: PanelTab
  apiScope: ApiScope
}

const TerminalContent = memo(function TerminalContent({ activeTab, apiScope }: TerminalContentProps) {
  const { panelTabs } = useLayoutStore()
  const scopeKey = apiScopeKey(apiScope)

  // 获取当前 scope 的 bottom terminal tabs
  const terminalTabs = panelTabs.filter(
    tab => tab.position === 'bottom' && tab.type === 'terminal' && tab.scopeKey === scopeKey,
  )

  return (
    <>
      {terminalTabs.map(tab => (
        <Terminal key={`${scopeKey}:${tab.id}`} ptyId={tab.id} apiScope={apiScope} isActive={tab.id === activeTab.id} />
      ))}
    </>
  )
})

interface FilesContentProps {
  activeTab: PanelTab
  directory?: string
  isPanelResizing?: boolean
  sessionId?: string | null
}

const FilesContent = memo(function FilesContent({
  activeTab,
  directory,
  isPanelResizing = false,
  sessionId,
}: FilesContentProps) {
  const { panelTabs } = useLayoutStore()
  const fileTabs = panelTabs.filter(t => t.position === 'bottom' && t.type === 'files')

  return (
    <>
      {fileTabs.map(tab => (
        <div key={tab.id} className={tab.id === activeTab.id ? 'h-full' : 'hidden'}>
          <FileExplorer
            panelTabId={tab.id}
            directory={directory}
            previewFile={tab.previewFile ?? null}
            previewFiles={tab.previewFiles ?? []}
            position="bottom"
            isPanelResizing={isPanelResizing}
            sessionId={sessionId}
          />
        </div>
      ))}
    </>
  )
})

interface ChangesContentProps {
  activeTab: PanelTab
  directory?: string
  sessionId: string
  isPanelResizing?: boolean
}

const ChangesContent = memo(function ChangesContent({
  activeTab,
  directory,
  sessionId,
  isPanelResizing = false,
}: ChangesContentProps) {
  const { panelTabs } = useLayoutStore()
  const changeTabs = panelTabs.filter(t => t.position === 'bottom' && t.type === 'changes')

  return (
    <>
      {changeTabs.map(tab => (
        <div key={tab.id} className={tab.id === activeTab.id ? 'h-full' : 'hidden'}>
          <SessionChangesPanel sessionId={sessionId} directory={directory} isResizing={isPanelResizing} />
        </div>
      ))}
    </>
  )
})

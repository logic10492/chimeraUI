import { lazy, memo, Suspense, useCallback, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLayoutStore, layoutStore, type PanelTab } from '../store/layoutStore'
import { PanelContainer } from './PanelContainer'
import { createPtySession, removePtySession } from '../api/pty'
import { activeApiScope, apiScopeKey, resolveSessionApiScope, type ApiScope } from '../api/scope'
import type { TerminalTab } from '../store/layoutStore'
import { ResizablePanel } from './ui/ResizablePanel'
import { logger } from '../utils/logger'
import { normalizeToForwardSlash, uiErrorHandler } from '../utils'
import { useChatViewport } from '../features/chat/chatViewport'

const SessionChangesPanel = lazy(() =>
  import('./SessionChangesPanel').then(module => ({ default: module.SessionChangesPanel })),
)
const FileExplorer = lazy(() => import('./FileExplorer').then(module => ({ default: module.FileExplorer })))
const Terminal = lazy(() => import('./Terminal').then(module => ({ default: module.Terminal })))
const McpPanel = lazy(() => import('./McpPanel').then(module => ({ default: module.McpPanel })))
const SkillPanel = lazy(() => import('./SkillPanel').then(module => ({ default: module.SkillPanel })))
const WorktreePanel = lazy(() => import('./WorktreePanel').then(module => ({ default: module.WorktreePanel })))
const SessionStatusPanel = lazy(() =>
  import('./SessionStatusPanel').then(module => ({ default: module.SessionStatusPanel })),
)

function PanelFallback() {
  const { t } = useTranslation(['components', 'common'])
  return (
    <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
      {t('rightPanel.loadingPanel')}
    </div>
  )
}

interface RightPanelProps {
  directory?: string
  sessionId?: string | null
  providerId?: string
  inline?: boolean
  renderPanelContent?: boolean
}

export const RightPanel = memo(function RightPanel({
  directory,
  sessionId,
  providerId,
  inline = false,
  renderPanelContent = true,
}: RightPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { rightPanelOpen, rightPanelWidth } = useLayoutStore()
  const { interaction, layout } = useChatViewport()
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

  // 关闭终端时清理 PTY 会话
  const handleCloseTerminal = useCallback(
    async (ptyId: string) => {
      try {
        await removePtySession(ptyId, getTerminalScope())
      } catch {
        // ignore cleanup errors
      }
    },
    [getTerminalScope],
  )

  // 创建新终端
  const handleNewTerminal = useCallback(async () => {
    try {
      const scope = getTerminalScope()
      logger.log('[RightPanel] Creating PTY session for scope:', apiScopeKey(scope))
      const pty = await createPtySession({ cwd: normalizedDirectory }, scope)
      logger.log('[RightPanel] PTY created:', pty)
      const tab: TerminalTab = {
        id: pty.id,
        scopeKey: apiScopeKey(scope),
        title: pty.title || 'Terminal',
        status: 'connecting',
      }
      layoutStore.addTerminalTab(tab, true, 'right')
    } catch (error) {
      uiErrorHandler('create terminal', error)
    }
  }, [getTerminalScope, normalizedDirectory])

  // 渲染内容
  const renderContent = useCallback(
    (activeTab: PanelTab | null) => {
      if (!activeTab) {
        return (
          <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
            {t('common:noContent')}
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
                providerId={providerId}
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
        </>
      )
    },
    [getTerminalScope, normalizedDirectory, sessionId, providerId, isPanelResizing, t],
  )

  if (inline) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-bg-100 [contain:layout_paint]">
        {renderPanelContent ? (
          <PanelContainer
            position="right"
            directory={normalizedDirectory}
            terminalApiScope={getTerminalScope()}
            onNewTerminal={handleNewTerminal}
            onCloseTerminal={handleCloseTerminal}
            forceOpen
          >
            {renderContent}
          </PanelContainer>
        ) : null}
      </div>
    )
  }

  return (
    <ResizablePanel
      position="right"
      isOpen={rightPanelOpen}
      overlay={interaction.rightPanelBehavior === 'overlay'}
      size={layout.rightPanel.dockedWidth || rightPanelWidth}
      minSize={layout.rightPanel.hardMinWidth}
      maxSize={layout.rightPanel.resizeMaxWidth}
      onSizeChange={w => layoutStore.setRightPanelWidth(w)}
      onClose={() => layoutStore.closeRightPanel()}
    >
      <PanelContainer
        position="right"
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
// Terminal Content - 渲染所有终端实例 (右侧面板)
// ============================================

interface TerminalContentProps {
  activeTab: PanelTab
  apiScope: ApiScope
}

const TerminalContent = memo(function TerminalContent({ activeTab, apiScope }: TerminalContentProps) {
  const { panelTabs } = useLayoutStore()
  const scopeKey = apiScopeKey(apiScope)

  // 获取当前 scope 的 right terminal tabs
  const terminalTabs = panelTabs.filter(
    tab => tab.position === 'right' && tab.type === 'terminal' && tab.scopeKey === scopeKey,
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
  const fileTabs = panelTabs.filter(t => t.position === 'right' && t.type === 'files')

  return (
    <>
      {fileTabs.map(tab => (
        <div key={tab.id} className={tab.id === activeTab.id ? 'h-full' : 'hidden'}>
          <FileExplorer
            panelTabId={tab.id}
            directory={directory}
            previewFile={tab.previewFile ?? null}
            previewFiles={tab.previewFiles ?? []}
            position="right"
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
  const changeTabs = panelTabs.filter(t => t.position === 'right' && t.type === 'changes')

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

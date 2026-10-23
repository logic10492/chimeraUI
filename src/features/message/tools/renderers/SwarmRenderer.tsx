import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRightIcon, ExternalLinkIcon, StopIcon } from '../../../../components/Icons'
import { useSessionNavigation } from '../../../../contexts/SessionNavigationContext'
import { abortSession } from '../../../../api/session'
import { childSessionStore } from '../../../../store/childSessionStore'
import { messageStore } from '../../../../store/messageStore'
import { useInlineToolRequests } from '../../../chat/InlineToolRequestContext'
import { InteractionCard } from '../../../chat/InteractionCard'
import { useServerCapabilities } from '../../../../hooks/useServerCapabilities'
import type { PermissionRequest as ApiPermissionRequest, QuestionRequest as ApiQuestionRequest } from '../../../../types/api/permission'
import type { ToolRendererProps } from '../types'
import { SubSessionView } from './TaskRenderer'

export type SwarmChildStatus = 'queued' | 'running' | 'completed' | 'error' | 'cancelled'

export interface SwarmChildRun {
  index: number
  title: string
  subagentType: string
  status: SwarmChildStatus
  sessionId?: string
  error?: string
}

export function getSwarmChildRuns(
  metadata: Record<string, unknown> | undefined,
  parentStatus?: string,
): SwarmChildRun[] {
  const background = metadata?.background === true
  const normalize = (run: Record<string, unknown>, position: number): SwarmChildRun => {
    const sessionId = typeof run.sessionId === 'string' ? run.sessionId : undefined
    return {
      index: typeof run.index === 'number' ? run.index : position + 1,
      title: typeof run.title === 'string' ? run.title : `Child ${position + 1}`,
      subagentType:
        typeof run.subagentType === 'string'
          ? run.subagentType
          : typeof run.subagent_type === 'string'
            ? run.subagent_type
            : 'general',
      status: normalizeSwarmChildStatus(run.status, parentStatus, sessionId, background),
      sessionId,
      error: typeof run.error === 'string' ? run.error : undefined,
    }
  }

  const childRuns = Array.isArray(metadata?.childRuns) ? metadata.childRuns : []
  if (childRuns.length > 0) {
    return childRuns
      .filter((run): run is Record<string, unknown> => !!run && typeof run === 'object')
      .map(normalize)
      .sort((a, b) => a.index - b.index)
  }

  const runs = new Map<number, Record<string, unknown>>()
  const childSessions = Array.isArray(metadata?.childSessions) ? metadata.childSessions : []
  childSessions.forEach((session, position) => {
    const run =
      typeof session === 'string'
        ? { index: position + 1, sessionId: session }
        : session && typeof session === 'object'
          ? (session as Record<string, unknown>)
          : undefined
    if (!run) return
    const index = typeof run.index === 'number' ? run.index : position + 1
    runs.set(index, { ...run, index })
  })

  const results = Array.isArray(metadata?.results) ? metadata.results : []
  results.forEach((result, position) => {
    if (!result || typeof result !== 'object') return
    const run = result as Record<string, unknown>
    const index = typeof run.index === 'number' ? run.index : position + 1
    runs.set(index, { ...(runs.get(index) ?? {}), ...run, index })
  })

  return Array.from(runs.values()).map(normalize).sort((a, b) => a.index - b.index)
}

export function findRequestForChild<T extends ApiPermissionRequest | ApiQuestionRequest>(
  requests: T[],
  sessionId: string | undefined,
): T | undefined {
  if (!sessionId) return undefined
  return requests.find(request => request.sessionID === sessionId || childSessionStore.isChildOf(request.sessionID, sessionId))
}

export const SwarmRenderer = memo(function SwarmRenderer({ part }: ToolRendererProps) {
  const metadata = part.state.metadata as Record<string, unknown> | undefined
  const background = metadata?.background === true
  const childRuns = useMemo(() => getSwarmChildRuns(metadata, part.state.status), [metadata, part.state.status])

  if (childRuns.length === 0) {
    // A background receipt is terminal: the completed part will never grow
    // childRuns, so do not promise subagents that cannot appear.
    if (background && (part.state.status === 'completed' || part.state.status === 'error')) return null
    return <div className="text-[length:var(--fs-sm)] text-text-500 italic py-2">Waiting for subagents...</div>
  }

  return (
    <div className="space-y-2">
      {background && <SwarmBackgroundBadge />}
      {childRuns.map(run => (
        <SwarmChild key={`${run.index}:${run.sessionId ?? run.title}`} run={run} background={background} />
      ))}
    </div>
  )
})

// F4 background dispatch: same capabilities gate as TaskRenderer. Mounted only
// for background parts so non-background swarms never probe capabilities.
const SwarmBackgroundBadge = memo(function SwarmBackgroundBadge() {
  const { t } = useTranslation('message')
  const capabilities = useServerCapabilities()
  if (!capabilities.backgroundSubagents) return null
  return (
    <span className="inline-flex px-1.5 py-0.5 text-[length:var(--fs-xxs)] font-medium rounded-xs bg-bg-300 text-text-400">
      {t('task.background')}
    </span>
  )
})

const SwarmChild = memo(function SwarmChild({ run, background }: { run: SwarmChildRun; background: boolean }) {
  const { t } = useTranslation('message')
  const { currentSessionId, currentDirectory, navigateToSession } = useSessionNavigation()
  const status = useLiveChildStatus(run, background)
  const [expanded, setExpanded] = useState(status === 'queued' || status === 'running')
  const { pendingPermissions, pendingQuestions, onPermissionReply, onQuestionReply, onQuestionReject, isReplying } =
    useInlineToolRequests()
  const permissionRequest = findRequestForChild(pendingPermissions, run.sessionId)
  const questionRequest = findRequestForChild(pendingQuestions, run.sessionId)
  const isRunning = status === 'running'

  // Background children keep expanding as their derived status advances; frozen
  // non-background runs keep the original mount-time expansion only.
  useEffect(() => {
    if (background && (status === 'running' || status === 'queued')) setExpanded(true)
  }, [background, status])
  const getDirectory = useCallback(() => {
    const childInfo = run.sessionId ? childSessionStore.getSessionInfo(run.sessionId) : undefined
    const parentSessionId = childInfo?.parentID || currentSessionId || null
    return (parentSessionId ? messageStore.getSessionState(parentSessionId)?.directory : undefined) || currentDirectory || ''
  }, [run.sessionId, currentSessionId, currentDirectory])

  const handleStop = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (!run.sessionId) return
      abortSession(run.sessionId, getDirectory())
    },
    [run.sessionId, getDirectory],
  )

  const handleOpenSession = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (!run.sessionId) return
      navigateToSession(run.sessionId, getDirectory() || undefined)
    },
    [run.sessionId, navigateToSession, getDirectory],
  )

  return (
    <div className="rounded-md border border-border-200/30 bg-bg-100/30 px-2.5 py-1.5" data-child-index={run.index}>
      <div className="flex items-center gap-2 group">
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left bg-transparent border-none p-0"
        >
          <span className={`text-text-400 transition-transform ${expanded ? 'rotate-90' : ''}`}>
            <ChevronRightIcon size={12} />
          </span>
          <span className="text-[length:var(--fs-xxs)] font-mono text-text-500 tabular-nums">#{run.index}</span>
          <span className={`px-1.5 py-0.5 text-[length:var(--fs-xxs)] font-medium rounded-xs ${statusClass(status)}`}>
            {status}
          </span>
          <span className="px-1.5 py-0.5 text-[length:var(--fs-xxs)] font-medium rounded-xs bg-bg-300 text-text-300">
            {run.subagentType}
          </span>
          <span className="text-[length:var(--fs-sm)] text-text-300 truncate flex-1 min-w-0">{run.title}</span>
        </button>

        {isRunning && run.sessionId && (
          <button
            type="button"
            onClick={handleStop}
            aria-label={t('task.stop')}
            title={t('task.stop')}
            className="flex-shrink-0 w-[18px] h-[18px] p-0 flex items-center justify-center text-text-400 hover:text-danger-100 hover:bg-danger-100/10 rounded-sm transition-colors active:scale-90 bg-transparent border-none"
          >
            <StopIcon size={10} />
          </button>
        )}

        {run.sessionId && (
          <button
            type="button"
            onClick={handleOpenSession}
            aria-label={t('task.openSession')}
            title={t('task.openSession')}
            className="flex-shrink-0 p-1 text-text-500 hover:text-accent-main-100 transition-all bg-transparent border-none"
          >
            <ExternalLinkIcon size={12} />
          </button>
        )}
      </div>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          {expanded && (
            <div className="pt-2 space-y-2">
              {run.sessionId && <SubSessionView sessionId={run.sessionId} isParentRunning={isRunning} />}
              {permissionRequest && (
                <InteractionCard
                  variant="inline"
                  permission={permissionRequest}
                  onPermissionReply={onPermissionReply}
                  onQuestionReply={onQuestionReply}
                  onQuestionReject={onQuestionReject}
                  isReplying={isReplying}
                />
              )}
              {questionRequest && (
                <InteractionCard
                  variant="inline"
                  question={questionRequest}
                  onPermissionReply={onPermissionReply}
                  onQuestionReply={onQuestionReply}
                  onQuestionReject={onQuestionReject}
                  isReplying={isReplying}
                />
              )}
              {run.error && <div className="text-[length:var(--fs-xs)] text-danger-100 whitespace-pre-wrap">{run.error}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

function normalizeSwarmChildStatus(
  status: unknown,
  parentStatus: string | undefined,
  sessionId: string | undefined,
  background = false,
): SwarmChildStatus {
  if (status === 'success') return 'completed'
  if (status === 'failure') return 'error'
  if (isSwarmChildStatus(status)) return status
  // Background receipts freeze childRuns forever, so an unknown status is not
  // evidence of completion: only ever fall back to queued/running there.
  if (background) return sessionId ? 'running' : 'queued'
  if (parentStatus === 'running') return sessionId ? 'running' : 'queued'
  if (parentStatus === 'error') return 'error'
  return 'completed'
}

function isSwarmChildStatus(status: unknown): status is SwarmChildStatus {
  return status === 'queued' || status === 'running' || status === 'completed' || status === 'error' || status === 'cancelled'
}

function statusClass(status: SwarmChildStatus): string {
  if (status === 'running') return 'bg-accent-main-100/20 text-accent-main-100'
  if (status === 'completed') return 'bg-accent-secondary-100/20 text-accent-secondary-100'
  if (status === 'error') return 'bg-danger-100/20 text-danger-100'
  if (status === 'cancelled') return 'bg-warning-100/20 text-warning-100'
  return 'bg-bg-300 text-text-400'
}

// Background parts freeze childRuns at the launch receipt, so live progress must
// come from the child session stores. Frozen status is only the initial placeholder.
function useLiveChildStatus(run: SwarmChildRun, background: boolean): SwarmChildStatus {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!background) return () => {}
      const unsubscribeChildren = childSessionStore.subscribe(onChange)
      const unsubscribeMessages = messageStore.subscribe(onChange)
      return () => {
        unsubscribeChildren()
        unsubscribeMessages()
      }
    },
    [background],
  )
  const getSnapshot = useCallback(
    () => (background ? deriveBackgroundChildStatus(run.sessionId, run.status) : run.status),
    [background, run.sessionId, run.status],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function deriveBackgroundChildStatus(sessionId: string | undefined, frozen: SwarmChildStatus): SwarmChildStatus {
  if (!sessionId) return 'queued'
  const info = childSessionStore.getSessionInfo(sessionId)
  if (info?.status === 'error') return 'error'
  if (info?.status === 'idle') return 'completed'
  if (info?.status === 'running') return 'running'
  if (messageStore.getSessionState(sessionId)?.isStreaming) return 'running'
  return frozen
}

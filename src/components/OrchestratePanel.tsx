import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  CloseIcon,
  ExternalLinkIcon,
  SpinnerIcon,
  StopIcon,
} from './Icons'
import { abortSession } from '../api/session'
import { useSessionNavigation } from '../contexts/SessionNavigationContext'
import { useSessionState } from '../store/messageStoreHooks'
import { childSessionStore } from '../store/childSessionStore'
import { messageStore } from '../store/messageStore'
import { useInlineToolRequests } from '../features/chat/InlineToolRequestContext'
import { InteractionCard } from '../features/chat/InteractionCard'
import { MarkdownRenderer } from './MarkdownRenderer'
import {
  getCurrentStageIndex,
  getOrchestrateRuns,
  getOrchestrateSessionIds,
  groupAgentsByStage,
  resolveOrchestrateAgentStatus,
  type OrchestrateAgentRun,
  type OrchestrateAgentStatus,
  type OrchestrateRun,
  type OrchestrateRunStatus,
  type OrchestrateStage,
} from '../features/message/tools/renderers/orchestrateUtils'
import type { Message } from '../types/message'
import type { PermissionRequest as ApiPermissionRequest, QuestionRequest as ApiQuestionRequest } from '../types/api/permission'

interface OrchestratePanelProps {
  sessionId?: string | null
  directory?: string
  active: boolean
}

const EMPTY_MESSAGES: Message[] = []

function findRequestForChild<T extends ApiPermissionRequest | ApiQuestionRequest>(
  requests: T[],
  sessionId: string | undefined,
): T | undefined {
  if (!sessionId) return undefined
  return requests.find(request => request.sessionID === sessionId || childSessionStore.isChildOf(request.sessionID, sessionId))
}

/**
 * One subscription for the whole panel: statuses of every child session are
 * derived from childSessionStore + messageStore, never one subscription per row.
 * Returns a stable key so useSyncExternalStore re-renders on any relevant change.
 */
function useLiveStatusKey(sessionIds: string[], active: boolean): string {
  const sessionKey = sessionIds.join(',')
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!active) return () => {}
      const unsubscribeChildren = childSessionStore.subscribe(onChange)
      const unsubscribeMessages = messageStore.subscribe(onChange)
      return () => {
        unsubscribeChildren()
        unsubscribeMessages()
      }
    },
    [active],
  )
  const getSnapshot = useCallback(() => {
    if (!sessionKey) return ''
    return sessionKey
      .split(',')
      .map(sessionId => {
        const info = childSessionStore.getSessionInfo(sessionId)
        const streaming = messageStore.getSessionState(sessionId)?.isStreaming ? '1' : '0'
        return `${sessionId}:${info?.status ?? ''}:${streaming}`
      })
      .join('|')
  }, [sessionKey])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function deriveLiveAgentStatus(agent: OrchestrateAgentRun, active: boolean): OrchestrateAgentStatus {
  if (!active || agent.status !== 'running' || !agent.sessionId) return agent.status
  const info = childSessionStore.getSessionInfo(agent.sessionId)
  if (info?.status === 'error') return 'error'
  if (info?.status === 'idle') return 'completed'
  if (info?.status === 'running') return 'running'
  if (messageStore.getSessionState(agent.sessionId)?.isStreaming) return 'running'
  // No terminal evidence yet: keep showing running instead of inventing completion.
  return 'running'
}

function statusClass(status: OrchestrateAgentStatus | OrchestrateRunStatus): string {
  if (status === 'running') return 'bg-accent-main-100/20 text-accent-main-100'
  if (status === 'completed') return 'bg-accent-secondary-100/20 text-accent-secondary-100'
  if (status === 'error') return 'bg-danger-100/20 text-danger-100'
  if (status === 'cancelled') return 'bg-warning-100/20 text-warning-100'
  return 'bg-bg-300 text-text-400'
}

function statusLabelKey(status: OrchestrateAgentStatus | OrchestrateRunStatus): string {
  if (status === 'error') return 'orchestratePanel.status.failed'
  return `orchestratePanel.status.${status}`
}

function StageStatusIcon({ status }: { status: OrchestrateAgentStatus }) {
  if (status === 'completed') return <CheckIcon size={12} className="shrink-0 text-accent-secondary-100" />
  if (status === 'running') return <SpinnerIcon size={12} className="shrink-0 animate-spin text-accent-main-100" />
  if (status === 'error' || status === 'cancelled') return <CloseIcon size={12} className="shrink-0 text-danger-100" />
  return <CircleIcon size={8} className="shrink-0 text-text-500" />
}

export const OrchestratePanel = memo(function OrchestratePanel({ sessionId, directory, active }: OrchestratePanelProps) {
  const { t } = useTranslation('components')
  const sessionState = useSessionState(sessionId ?? null)
  const runs = useMemo(() => getOrchestrateRuns(sessionState?.messages ?? EMPTY_MESSAGES), [sessionState?.messages])
  const sessionIds = useMemo(() => getOrchestrateSessionIds(runs), [runs])
  useLiveStatusKey(sessionIds, active)

  if (!sessionId) {
    return <EmptyState text={t('orchestratePanel.noSession')} />
  }

  if (runs.length === 0) {
    return <EmptyState text={t('orchestratePanel.empty')} />
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg-100 px-3 py-2">
      {sessionState?.hasMoreHistory && (
        <div className="mb-2 rounded-md border border-border-200/30 bg-bg-200/40 px-2.5 py-1.5 text-[length:var(--fs-xxs)] text-text-400">
          {t('orchestratePanel.onlyLoadedHistory')}
        </div>
      )}
      <div className="space-y-3">
        {runs.map(run => (
          <OrchestrateRunCard key={run.id} run={run} directory={directory} active={active} />
        ))}
      </div>
    </div>
  )
})

const EmptyState = memo(function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-[length:var(--fs-sm)] text-text-400">
      {text}
    </div>
  )
})

const OrchestrateRunCard = memo(function OrchestrateRunCard({
  run,
  directory,
  active,
}: {
  run: OrchestrateRun
  directory?: string
  active: boolean
}) {
  const { t } = useTranslation('components')

  const agents = run.agents.map(agent => ({
    ...agent,
    status: resolveOrchestrateAgentStatus(agent.status, run.status, deriveLiveAgentStatus(agent, active)),
  }))
  const stages = groupAgentsByStage(agents)
  const currentStage = getCurrentStageIndex(stages)

  return (
    <section className="rounded-md border border-border-200/40 bg-bg-000/40">
      <header className="flex items-center gap-2 border-b border-border-200/30 px-2.5 py-1.5">
        <span
          data-status={run.status}
          className={`shrink-0 rounded-xs px-1.5 py-0.5 text-[length:var(--fs-xxs)] font-medium ${statusClass(run.status)}`}
        >
          {t(statusLabelKey(run.status))}
        </span>
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-text-200">
          {run.title || t('orchestratePanel.untitled')}
        </span>
        {stages.length > 0 && (
          <span className="shrink-0 text-[length:var(--fs-xxs)] tabular-nums text-text-500">
            {t('orchestratePanel.stageCount', { current: currentStage + 1, total: stages.length })}
          </span>
        )}
        <span className="shrink-0 text-[length:var(--fs-xxs)] tabular-nums text-text-500">
          {t('orchestratePanel.agentCount', { count: agents.length })}
        </span>
      </header>

      {run.error && (
        <div className="mx-2.5 mt-2 whitespace-pre-wrap rounded-sm bg-danger-100/10 px-2 py-1 text-[length:var(--fs-xs)] text-danger-100">
          {run.error}
        </div>
      )}

      {agents.length === 0 ? (
        <div className="px-3 py-2 text-[length:var(--fs-xs)] italic text-text-500">{t('orchestratePanel.noAgents')}</div>
      ) : (
        <div className="space-y-1.5 p-2">
          {stages.map((stage, index) => (
            <StageSection key={stage.name} stage={stage} current={index === currentStage} directory={directory} />
          ))}
        </div>
      )}

      {run.logs.length > 0 && <LogStream logs={run.logs} />}

      {(run.code || run.output) && (
        <div className="space-y-1 border-t border-border-200/30 px-2.5 py-1.5">
          {run.code && (
            <details>
              <summary className="cursor-pointer select-none text-[length:var(--fs-xxs)] text-text-500 hover:text-text-300">
                {t('orchestratePanel.viewProgram')}
              </summary>
              <pre
                data-testid="orchestrate-code"
                className="mt-1 max-h-60 overflow-auto rounded-sm bg-bg-200/50 p-2 text-[length:var(--fs-code)] text-text-300"
              >
                <code>{run.code}</code>
              </pre>
            </details>
          )}
          {run.output && (
            <details>
              <summary className="cursor-pointer select-none text-[length:var(--fs-xxs)] text-text-500 hover:text-text-300">
                {t('orchestratePanel.result')}
              </summary>
              <div className="mt-1 max-h-80 overflow-auto rounded-sm bg-bg-200/30 p-2">
                <MarkdownRenderer content={run.output} />
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  )
})

const StageSection = memo(function StageSection({
  stage,
  current,
  directory,
}: {
  stage: OrchestrateStage
  current: boolean
  directory?: string
}) {
  const { t } = useTranslation('components')
  const [override, setOverride] = useState<boolean | undefined>(undefined)
  // The current stage opens automatically; users can still collapse it or open
  // any finished stage manually for the full agent list.
  const expanded = override ?? current

  return (
    <div
      data-stage-index={stage.index}
      data-status={stage.status}
      className={`rounded-md border bg-bg-100/30 ${
        current ? 'border-accent-main-100/30' : 'border-border-200/30'
      }`}
    >
      <button
        type="button"
        onClick={() => setOverride(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 border-none bg-transparent px-2.5 py-1.5 text-left"
      >
        {expanded ? (
          <ChevronDownIcon size={10} className="shrink-0 text-text-500" />
        ) : (
          <ChevronRightIcon size={10} className="shrink-0 text-text-500" />
        )}
        <StageStatusIcon status={stage.status} />
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-text-300">{stage.name}</span>
        {current && (
          <span className="shrink-0 rounded-xs bg-accent-main-100/20 px-1.5 py-0.5 text-[length:var(--fs-xxs)] text-accent-main-100">
            {t('orchestratePanel.currentStage')}
          </span>
        )}
        <span className="shrink-0 text-[length:var(--fs-xxs)] tabular-nums text-text-500">
          {t('orchestratePanel.stageProgress', { completed: stage.stats.completed, total: stage.stats.total })}
        </span>
      </button>

      {expanded && (
        <div className="space-y-1.5 px-2 pb-2">
          {stage.agents.map(agent => (
            <AgentRow key={`${agent.index}:${agent.sessionId ?? agent.label}`} agent={agent} directory={directory} />
          ))}
        </div>
      )}
    </div>
  )
})

const AgentRow = memo(function AgentRow({
  agent,
  directory,
}: {
  agent: OrchestrateAgentRun
  directory?: string
}) {
  const { t } = useTranslation('components')
  const { navigateToSession } = useSessionNavigation()
  const { pendingPermissions, pendingQuestions, onPermissionReply, onQuestionReply, onQuestionReject, isReplying } =
    useInlineToolRequests()

  const permissionRequest = findRequestForChild(pendingPermissions, agent.sessionId)
  const questionRequest = findRequestForChild(pendingQuestions, agent.sessionId)
  const openSession = () => {
    if (!agent.sessionId) return
    navigateToSession(agent.sessionId, directory)
  }
  const stopSession = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!agent.sessionId) return
    void abortSession(agent.sessionId, directory)
  }

  return (
    <div
      data-agent-index={agent.index}
      data-status={agent.status}
      className="rounded-md border border-border-200/30 bg-bg-100/30 px-2.5 py-1.5"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openSession}
          disabled={!agent.sessionId}
          className="flex min-w-0 flex-1 items-center gap-2 border-none bg-transparent p-0 text-left disabled:cursor-default"
        >
          <span className="shrink-0 font-mono text-[length:var(--fs-xxs)] tabular-nums text-text-500">#{agent.index}</span>
          <span
            className={`shrink-0 rounded-xs px-1.5 py-0.5 text-[length:var(--fs-xxs)] font-medium ${statusClass(agent.status)}`}
          >
            {t(statusLabelKey(agent.status))}
          </span>
          <span className="shrink-0 rounded-xs bg-bg-300 px-1.5 py-0.5 text-[length:var(--fs-xxs)] font-medium text-text-300">
            {agent.agent}
          </span>
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-text-300">{agent.label}</span>
        </button>

        {agent.status === 'running' && agent.sessionId && (
          <button
            type="button"
            onClick={stopSession}
            aria-label={t('orchestratePanel.stop')}
            title={t('orchestratePanel.stop')}
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm border-none bg-transparent p-0 text-text-400 transition-colors hover:bg-danger-100/10 hover:text-danger-100 active:scale-90"
          >
            <StopIcon size={10} />
          </button>
        )}
        {agent.sessionId && (
          <button
            type="button"
            onClick={openSession}
            aria-label={t('orchestratePanel.openSession')}
            title={t('orchestratePanel.openSession')}
            className="shrink-0 border-none bg-transparent p-1 text-text-500 transition-all hover:text-accent-main-100"
          >
            <ExternalLinkIcon size={12} />
          </button>
        )}
      </div>

      {agent.error && (
        <div className="mt-1 whitespace-pre-wrap text-[length:var(--fs-xs)] text-danger-100">{agent.error}</div>
      )}

      {permissionRequest && (
        <div className="pt-2">
          <InteractionCard
            variant="inline"
            permission={permissionRequest}
            onPermissionReply={onPermissionReply}
            onQuestionReply={onQuestionReply}
            onQuestionReject={onQuestionReject}
            isReplying={isReplying}
          />
        </div>
      )}
      {questionRequest && (
        <div className="pt-2">
          <InteractionCard
            variant="inline"
            question={questionRequest}
            onPermissionReply={onPermissionReply}
            onQuestionReply={onQuestionReply}
            onQuestionReject={onQuestionReject}
            isReplying={isReplying}
          />
        </div>
      )}
    </div>
  )
})

const LogStream = memo(function LogStream({ logs }: { logs: string[] }) {
  const { t } = useTranslation('components')
  const containerRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !following) return
    container.scrollTop = container.scrollHeight
  }, [logs, following])

  const onScroll = () => {
    const container = containerRef.current
    if (!container) return
    setFollowing(container.scrollHeight - container.scrollTop - container.clientHeight < 24)
  }

  return (
    <div className="border-t border-border-200/30 px-2.5 py-1.5">
      <div className="mb-1 flex items-center gap-2 text-[length:var(--fs-xxs)] text-text-500">
        <span className="font-medium">{t('orchestratePanel.logs')}</span>
        {!following && (
          <button
            type="button"
            onClick={() => setFollowing(true)}
            className="border-none bg-transparent p-0 text-[length:var(--fs-xxs)] text-accent-main-100 hover:underline"
          >
            {t('orchestratePanel.followLogs')}
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        onScroll={onScroll}
        data-testid="orchestrate-logs"
        className="max-h-40 overflow-y-auto rounded-sm bg-bg-200/40 p-1.5 font-mono text-[length:var(--fs-code)] leading-4 text-text-300"
      >
        {logs.map((line, index) => (
          <div key={index} className="whitespace-pre-wrap break-words">
            {line}
          </div>
        ))}
      </div>
    </div>
  )
})
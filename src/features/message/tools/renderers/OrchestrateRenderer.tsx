import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, ChevronRightIcon } from '../../../../components/Icons'
import { layoutStore } from '../../../../store/layoutStore'
import type { ToolRendererProps } from '../types'
import {
  getCurrentStageIndex,
  getOrchestrateAgents,
  getOrchestrateStats,
  groupAgentsByStage,
  resolveOrchestrateAgentStatus,
  type OrchestrateAgentStatus,
  type OrchestrateRunStatus,
} from './orchestrateUtils'

function readInputString(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = input?.[key]
  return typeof value === 'string' ? value : undefined
}

function statusLabelKey(status: OrchestrateAgentStatus | OrchestrateRunStatus): string {
  if (status === 'error') return 'orchestrate.status.failed'
  return `orchestrate.status.${status}`
}

/**
 * Compact message-stream card for the orchestrate tool: run title, current
 * stage, and stage/agent progress. Program code and output stay behind an
 * explicit disclosure; the full process view lives in the OrchestratePanel.
 */
export const OrchestrateRenderer = memo(function OrchestrateRenderer({ part }: ToolRendererProps) {
  const { t } = useTranslation('message')
  const [expanded, setExpanded] = useState(false)

  const runStatus: OrchestrateRunStatus =
    part.state.status === 'error' ? 'error' : part.state.status === 'completed' ? 'completed' : 'running'
  const agents = useMemo(
    () =>
      getOrchestrateAgents(part.state.metadata).map(agent => ({
        ...agent,
        status: resolveOrchestrateAgentStatus(agent.status, runStatus),
      })),
    [part.state.metadata, runStatus],
  )
  const stages = useMemo(() => groupAgentsByStage(agents), [agents])
  const stats = useMemo(() => getOrchestrateStats(agents), [agents])
  const currentStage = getCurrentStageIndex(stages)
  const stage = stages[currentStage]
  const stageStatus = stage?.status ?? runStatus

  const input = part.state.input as Record<string, unknown> | undefined
  const title =
    part.state.title ||
    readInputString(input, 'description') ||
    t('orchestrate.title')
  const code = readInputString(input, 'code')
  const output = part.state.output
  const error = part.state.status === 'error' ? part.state.error : undefined

  return (
    <div data-testid="orchestrate-card" className="rounded-md border border-border-200/40 bg-bg-000/40 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] font-medium text-text-200">{title}</span>
        {stage && (
          <span className="shrink-0 truncate rounded-xs bg-bg-300 px-1.5 py-0.5 text-[length:var(--fs-xxs)] text-text-300">
            {stage.name}
          </span>
        )}
        <span className="shrink-0 text-[length:var(--fs-xxs)] tabular-nums text-text-500">
          {stages.length > 0
            ? t('orchestrate.progress', {
                stage: currentStage + 1,
                stages: stages.length,
                completed: stats.completed,
                total: stats.total,
              })
            : t('orchestrate.agents', { count: stats.total })}
        </span>
        <span
          className={`shrink-0 rounded-xs px-1.5 py-0.5 text-[length:var(--fs-xxs)] ${
            stageStatus === 'running'
              ? 'bg-accent-main-100/20 text-accent-main-100'
              : stageStatus === 'completed'
                ? 'bg-accent-secondary-100/20 text-accent-secondary-100'
                : stageStatus === 'error' || stageStatus === 'cancelled'
                  ? 'bg-danger-100/20 text-danger-100'
                  : 'bg-bg-300 text-text-400'
          }`}
        >
          {t(statusLabelKey(stageStatus))}
        </span>
        <button
          type="button"
          onClick={() => layoutStore.addOrchestrateTab('right')}
          className="shrink-0 rounded-sm border border-border-200/50 px-2 py-0.5 text-[length:var(--fs-xxs)] text-text-300 transition-colors hover:bg-bg-200/60 hover:text-text-100"
        >
          {t('orchestrate.openPanel')}
        </button>
      </div>

      {error && <div className="mt-1.5 whitespace-pre-wrap text-[length:var(--fs-xs)] text-danger-100">{error}</div>}

      {(code || output) && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            aria-expanded={expanded}
            className="flex items-center gap-1 border-none bg-transparent p-0 text-[length:var(--fs-xxs)] text-text-400 transition-colors hover:text-text-200"
          >
            {expanded ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
            {t('orchestrate.viewProgram')}
          </button>
          <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              {expanded && (
                <div className="space-y-2 pt-1.5">
                  {code && (
                    <div>
                      <div className="mb-1 text-[length:var(--fs-xxs)] font-medium text-text-400">{t('orchestrate.code')}</div>
                      <pre
                        data-testid="orchestrate-code"
                        className="max-h-48 overflow-auto rounded-sm bg-bg-200/50 p-2 text-[length:var(--fs-code)] text-text-300"
                      >
                        <code>{code}</code>
                      </pre>
                    </div>
                  )}
                  {output && (
                    <div>
                      <div className="mb-1 text-[length:var(--fs-xxs)] font-medium text-text-400">{t('orchestrate.output')}</div>
                      <pre
                        data-testid="orchestrate-output"
                        className="max-h-64 overflow-auto whitespace-pre-wrap rounded-sm bg-bg-200/30 p-2 text-[length:var(--fs-code)] text-text-300"
                      >
                        {output}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
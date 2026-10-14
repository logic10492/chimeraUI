import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Process } from '../types/api/process'
import type { ProviderBalanceResult } from '../types/api/model'
import type { TodoItem } from '../types/api/event'
import type { WorkBrief } from '../types/api/session'
import { getProviderBalance } from '../api/client'
import { getSessionTodos, getSessionWorkBrief } from '../api/session'
import { listProcesses } from '../api/process'
import { subscribeToEvents } from '../api/events'
import { todoStore, useTodoStats, useTodos } from '../store/todoStore'
import { getSessionModelSelection, parseModelKey } from '../utils/modelUtils'
import { formatRelativeTime } from '../utils/dateUtils'
import { useModels } from '../hooks/useModels'
import { ChevronDownIcon } from './Icons'

interface SessionStatusPanelProps {
  sessionId?: string | null
  directory?: string
  active: boolean
  providerId?: string
}

type BalanceSummary = {
  label: string
  status: ProviderBalanceResult['status']
}

type BalanceDetail = {
  label: string
  value: string
}

const balanceCache = new Map<string, ProviderBalanceResult>()
const balanceInflight = new Map<string, Promise<ProviderBalanceResult>>()

function nonEmptyItems(items: string[] | undefined) {
  return items?.filter(item => item.trim()) ?? []
}

function balanceCacheKey(directory: string | undefined, providerId: string) {
  return `${directory ?? ''}:${providerId}`
}

function supportedBalanceProvider(providerId: string | undefined) {
  return providerId === 'openai' || providerId === 'deepseek'
}

function loadProviderBalance(providerId: string, directory: string | undefined, force = false) {
  const key = balanceCacheKey(directory, providerId)
  if (!force) {
    const cached = balanceCache.get(key)
    if (cached) return Promise.resolve(cached)
    const pending = balanceInflight.get(key)
    if (pending) return pending
  }

  const pending = getProviderBalance(providerId, directory).then(result => {
    balanceCache.set(key, result)
    balanceInflight.delete(key)
    return result
  })
  balanceInflight.set(key, pending)
  return pending
}

function providerBalanceName(providerId: string) {
  if (providerId === 'deepseek') return 'DeepSeek'
  if (providerId === 'openai') return 'Codex'
  return providerId
}

function finiteNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function formatPercent(value: unknown) {
  const number = finiteNumber(value)
  if (number === undefined) return '0%'
  return `${Math.round(number)}%`
}

function formatBalance(value: string) {
  const number = Number(value)
  if (!Number.isFinite(number)) return value
  return number.toFixed(2)
}

function quotaLimitName(label: string) {
  if (label === '5h') return '5-hour'
  if (label === 'weekly') return 'Weekly'
  return label
}

function lowestQuotaLimit(limits: Extract<ProviderBalanceResult, { kind: 'quota' }>['limits']) {
  return limits
    .map(limit => ({ limit, remaining: finiteNumber(limit.remaining_percent) }))
    .filter((item): item is { limit: (typeof limits)[number]; remaining: number } => item.remaining !== undefined)
    .sort((a, b) => a.remaining - b.remaining)[0]?.limit
}

function balanceSummary(account: ProviderBalanceResult): BalanceSummary | undefined {
  if (account.status === 'not_configured' || account.status === 'unsupported') return undefined
  if (account.kind === 'quota') {
    if (account.limits.length === 0) {
      const message = account.message ?? 'Codex usage unavailable'
      return { label: message, status: account.status }
    }
    return {
      label: `Codex ${formatPercent(lowestQuotaLimit(account.limits)?.remaining_percent)} left`,
      status: account.status,
    }
  }

  const info = account.balance_infos[0]
  if (!info) {
    const message = account.message ?? `${account.providerID} balance unavailable`
    return { label: message, status: account.status }
  }
  return { label: `${providerBalanceName(account.providerID)} ${info.currency} ${formatBalance(info.total_balance)}`, status: account.status }
}

function balanceDetails(account: ProviderBalanceResult): BalanceDetail[] {
  if (account.kind === 'quota') {
    if (account.limits.length === 0) return account.message ? [{ label: 'Status', value: account.message }] : []
    return account.limits.map(limit => ({
      label: quotaLimitName(limit.label),
      value: `${formatPercent(limit.remaining_percent)} left · ${formatPercent(limit.used_percent)} used`,
    }))
  }

  if (account.balance_infos.length === 0) return account.message ? [{ label: 'Status', value: account.message }] : []
  return account.balance_infos.flatMap(info => [
    { label: `${info.currency} total`, value: formatBalance(info.total_balance) },
    { label: `${info.currency} granted`, value: formatBalance(info.granted_balance) },
    { label: `${info.currency} topped up`, value: formatBalance(info.topped_up_balance) },
  ])
}

function statusTextClass(status: ProviderBalanceResult['status'] | undefined) {
  if (status === 'error') return 'text-danger-100'
  if (status === 'unavailable') return 'text-text-200'
  return 'text-text-400'
}

function briefStat(label: string, count: number) {
  return count > 0 ? `${label} ${count}` : undefined
}

function todoStatusLabel(todo: TodoItem) {
  if (todo.status === 'completed') return 'Done'
  if (todo.status === 'in_progress') return 'Active'
  if (todo.status === 'cancelled') return 'Cancelled'
  return 'Pending'
}

function todoStatusClass(todo: TodoItem) {
  if (todo.status === 'completed') return 'text-success-100'
  if (todo.status === 'in_progress') return 'text-accent-main-100'
  if (todo.status === 'cancelled') return 'text-text-500'
  return 'text-text-400'
}

function processOwnerLabel(process: Process, currentSessionId: string | null | undefined, thisSessionLabel: string) {
  const owner =
    process.sessionID === currentSessionId ? thisSessionLabel : process.sessionTitle ?? process.sessionID
  return process.agent ? `${owner} · ${process.agent}` : owner
}

const Section = memo(function Section({ title, children, count, headerRight }: { title: string; children: React.ReactNode; count?: string | number; headerRight?: React.ReactNode }) {
  return (
    <section className="shrink-0 border-b border-border-200/50 bg-bg-100 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[length:var(--fs-sm)] font-medium text-text-100">{title}</div>
        <div className="flex items-center gap-1">
          {count !== undefined ? <div className="text-[length:var(--fs-xs)] text-text-500">{count}</div> : null}
          {headerRight}
        </div>
      </div>
      {children}
    </section>
  )
})

export const SessionStatusPanel = memo(function SessionStatusPanel({ sessionId, directory, active, providerId }: SessionStatusPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { models } = useModels()
  const todos = useTodos(sessionId ?? null)
  const todoStats = useTodoStats(sessionId ?? null)
  const fetchedTodosRef = useRef(new Set<string>())
  const [workBrief, setWorkBrief] = useState<WorkBrief | null>(null)
  const [workBriefLoading, setWorkBriefLoading] = useState(false)
  const [workBriefExpanded, setWorkBriefExpanded] = useState(false)
  const [balance, setBalance] = useState<ProviderBalanceResult | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState(false)
  const [processes, setProcesses] = useState<Process[]>([])
  const [processesLoading, setProcessesLoading] = useState(false)

  const sessionModelProviderId = useMemo(() => {
    if (!sessionId) return undefined
    const selection = getSessionModelSelection(sessionId)
    if (!selection) return undefined
    return parseModelKey(selection.modelKey)?.providerId
  }, [sessionId])
  const resolvedProviderId = providerId ?? sessionModelProviderId ?? models[0]?.providerId

  const workBriefRows = useMemo(() => {
    if (!workBrief) return []
    return [
      { label: t('sessionStatus.intent'), value: workBrief.intent?.trim() },
      { label: t('sessionStatus.openQuestions'), value: nonEmptyItems(workBrief.openQuestions).slice(0, 2).join(' · ') },
      { label: t('sessionStatus.closeout'), value: nonEmptyItems(workBrief.closeout).slice(0, 2).join(' · ') },
    ].filter((row): row is { label: string; value: string } => Boolean(row.value))
  }, [t, workBrief])

  const workBriefStats = useMemo(() => {
    if (!workBrief) return []
    return [
      briefStat(t('sessionStatus.decisions'), nonEmptyItems(workBrief.confirmedDecisions).length),
      briefStat(t('sessionStatus.constraints'), nonEmptyItems(workBrief.constraints).length),
      briefStat(t('sessionStatus.acceptance'), nonEmptyItems(workBrief.acceptanceCriteria).length),
      briefStat(t('sessionStatus.evidence'), nonEmptyItems(workBrief.relevantEvidence).length),
    ].filter((item): item is string => Boolean(item))
  }, [t, workBrief])

  const workBriefFields = useMemo(() => {
    if (!workBrief) return []
    const fields: Array<{ label: string; text?: string; items?: string[] }> = [
      { label: t('sessionStatus.intent'), text: workBrief.intent?.trim() },
      { label: t('sessionStatus.decisions'), items: nonEmptyItems(workBrief.confirmedDecisions) },
      { label: t('sessionStatus.constraints'), items: nonEmptyItems(workBrief.constraints) },
      { label: t('sessionStatus.acceptance'), items: nonEmptyItems(workBrief.acceptanceCriteria) },
      { label: t('sessionStatus.openQuestions'), items: nonEmptyItems(workBrief.openQuestions) },
      { label: t('sessionStatus.evidence'), items: nonEmptyItems(workBrief.relevantEvidence) },
      { label: t('sessionStatus.closeout'), items: nonEmptyItems(workBrief.closeout) },
    ]
    return fields.filter(field => Boolean(field.text) || (field.items?.length ?? 0) > 0)
  }, [t, workBrief])

  const balanceSummaryValue = useMemo(() => (balance ? balanceSummary(balance) : undefined), [balance])
  const balanceDetailRows = useMemo(() => (balance ? balanceDetails(balance) : []), [balance])

  // 当前会话的进程排在前面，其余保持服务端 started_at 升序（sort 稳定）
  const processRows = useMemo(() => {
    if (!sessionId) return processes
    return [...processes].sort((a, b) => Number(b.sessionID === sessionId) - Number(a.sessionID === sessionId))
  }, [processes, sessionId])

  useEffect(() => {
    if (!active || !sessionId) return
    let disposed = false
    queueMicrotask(() => {
      if (!disposed) setWorkBriefLoading(true)
    })
    getSessionWorkBrief(sessionId, directory)
      .then(next => {
        if (!disposed) setWorkBrief(next)
      })
      .catch(() => {
        if (!disposed) setWorkBrief(null)
      })
      .finally(() => {
        if (!disposed) setWorkBriefLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [active, directory, sessionId])

  useEffect(() => {
    if (!active || !sessionId) return
    if (fetchedTodosRef.current.has(sessionId)) return
    fetchedTodosRef.current.add(sessionId)
    getSessionTodos(sessionId, directory)
      .then(items => todoStore.setTodos(sessionId, items))
      .catch(() => {})
  }, [active, directory, sessionId])

  useEffect(() => {
    if (!active || !supportedBalanceProvider(resolvedProviderId)) {
      queueMicrotask(() => {
        setBalance(null)
        setBalanceLoading(false)
        setBalanceError(false)
      })
      return
    }

    let disposed = false
    queueMicrotask(() => {
      if (!disposed) {
        setBalanceLoading(true)
        setBalanceError(false)
      }
    })
    loadProviderBalance(resolvedProviderId, directory)
      .then(next => {
        if (!disposed) setBalance(next)
      })
      .catch(() => {
        if (!disposed) setBalanceError(true)
      })
      .finally(() => {
        if (!disposed) setBalanceLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [active, directory, resolvedProviderId])

  useEffect(() => {
    if (!active || !sessionId) return
    return subscribeToEvents({
      onWorkBriefUpdated: data => {
        if (data.sessionID === sessionId) setWorkBrief(data.brief)
      },
      onSessionStatus: data => {
        if (data.sessionID !== sessionId || data.status.type !== 'idle' || !supportedBalanceProvider(resolvedProviderId)) return
        loadProviderBalance(resolvedProviderId, directory, true)
          .then(setBalance)
          .catch(() => setBalanceError(true))
      },
    })
  }, [active, directory, resolvedProviderId, sessionId])

  useEffect(() => {
    if (!active || !sessionId) return
    let disposed = false
    queueMicrotask(() => {
      if (!disposed) setProcessesLoading(true)
    })
    listProcesses(directory)
      .then(next => {
        if (!disposed) setProcesses(next)
      })
      .catch(() => {
        if (!disposed) setProcesses([])
      })
      .finally(() => {
        if (!disposed) setProcessesLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [active, directory, sessionId])

  useEffect(() => {
    if (!active || !sessionId) return
    // process.changed 的内联 process 类型比 Process 宽松，只把它当作 refetch 触发器
    return subscribeToEvents({
      onProcessChanged: () => {
        listProcesses(directory)
          .then(setProcesses)
          .catch(() => {})
      },
    })
  }, [active, directory, sessionId])

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg-100">
      <Section
        title={t('sessionStatus.workBrief')}
        count={workBriefStats.length > 0 ? workBriefStats.length : undefined}
        headerRight={
          workBrief ? (
            <button
              type="button"
              onClick={() => setWorkBriefExpanded(prev => !prev)}
              aria-expanded={workBriefExpanded}
              aria-label={workBriefExpanded ? t('sessionStatus.collapseWorkBrief') : t('sessionStatus.expandWorkBrief')}
              className="rounded-md p-1 text-text-400 transition hover:bg-bg-200/50 hover:text-text-200"
            >
              <ChevronDownIcon size={14} className={workBriefExpanded ? 'rotate-180' : undefined} />
            </button>
          ) : undefined
        }
      >
        {workBriefStats.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {workBriefStats.map(item => (
              <div key={item} className="rounded-md bg-bg-200/60 px-1.5 py-0.5 text-[length:var(--fs-xs)] text-text-400">
                {item}
              </div>
            ))}
          </div>
        ) : null}
        {workBriefExpanded && workBriefFields.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {workBriefFields.map(field => (
              <div key={field.label} className="min-w-0">
                <div className="text-[length:var(--fs-xs)] text-text-500">{field.label}</div>
                {field.text ? (
                  <div className="whitespace-pre-wrap break-words text-[length:var(--fs-sm)] text-text-200">{field.text}</div>
                ) : (
                  <div className="mt-0.5 flex flex-col gap-1">
                    {field.items?.map((item, index) => (
                      <div key={`${index}:${item}`} className="break-words text-[length:var(--fs-sm)] text-text-200">
                        · {item}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : workBriefRows.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {workBriefRows.map(row => (
              <div key={row.label} className="min-w-0">
                <div className="text-[length:var(--fs-xs)] text-text-500">{row.label}</div>
                <div className="truncate text-[length:var(--fs-sm)] text-text-200">{row.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-[length:var(--fs-sm)] text-text-400">
            {workBriefLoading ? t('sessionStatus.loadingWorkBrief') : t('sessionStatus.noWorkBrief')}
          </div>
        )}
      </Section>

      {supportedBalanceProvider(resolvedProviderId) ? (
        <Section title={t('sessionStatus.providerBalance')}>
          <div className="mt-2 rounded-lg border border-border-200/50 bg-bg-200/40 px-3 py-2">
            <div className="text-[length:var(--fs-sm)] font-medium text-text-100">{providerBalanceName(resolvedProviderId)}</div>
            <div className={`mt-1 truncate text-[length:var(--fs-sm)] ${statusTextClass(balanceSummaryValue?.status)}`}>
              {balanceLoading
                ? t('sessionStatus.loadingBalance')
                : balanceError
                  ? t('sessionStatus.failedBalance')
                  : balanceSummaryValue?.label ?? t('sessionStatus.noBalance')}
            </div>
            {balanceDetailRows.length > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {balanceDetailRows.map(detail => (
                  <div key={`${detail.label}:${detail.value}`} className="min-w-0 rounded-md bg-bg-100 px-2 py-1">
                    <div className="truncate text-[length:var(--fs-xs)] text-text-500">{detail.label}</div>
                    <div className="truncate text-[length:var(--fs-sm)] text-text-200">{detail.value}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title={t('sessionStatus.todo')} count={todoStats.total > 0 ? `${todoStats.completed}/${todoStats.total}` : undefined}>
        {todos.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            {todos.map((todo, index) => (
              <div key={`${index}:${todo.content}`} className="rounded-lg border border-border-200/50 bg-bg-200/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-[length:var(--fs-sm)] text-text-100">{todo.content}</div>
                  <div className={`shrink-0 text-[length:var(--fs-xs)] ${todoStatusClass(todo)}`}>{todoStatusLabel(todo)}</div>
                </div>
                <div className="mt-1 text-[length:var(--fs-xs)] text-text-500">{todo.priority}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-[length:var(--fs-sm)] text-text-400">{t('sessionStatus.noTodo')}</div>
        )}
      </Section>

      <Section title={t('sessionStatus.sessionProcesses')} count={processRows.length > 0 ? processRows.length : undefined}>
        {processRows.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            {processRows.map(process => (
              <div key={process.id} className="rounded-lg border border-border-200/50 bg-bg-200/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-[length:var(--fs-sm)] text-text-100">{process.command}</div>
                  <div className="shrink-0 text-[length:var(--fs-xs)] text-text-500">PID {process.pid}</div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div
                    className={`min-w-0 truncate text-[length:var(--fs-xs)] ${
                      process.sessionID === sessionId ? 'text-accent-main-100' : 'text-text-500'
                    }`}
                  >
                    {processOwnerLabel(process, sessionId, t('sessionStatus.processThisSession'))}
                  </div>
                  <div className="shrink-0 text-[length:var(--fs-xs)] text-text-500">
                    {formatRelativeTime(Date.parse(process.startedAt))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-[length:var(--fs-sm)] text-text-400">
            {processesLoading ? t('sessionStatus.loadingProcesses') : t('sessionStatus.noProcesses')}
          </div>
        )}
      </Section>
    </div>
  )
})

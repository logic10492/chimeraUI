import { useTranslation } from 'react-i18next'
import type { ActiveSessionEntry } from '../../../store/activeSessionStore'
import type { Session as ApiSession } from '../../../types/api/session'
import { startInternalDrag } from '../../../lib/internalDragCore'

interface ActiveSessionItemProps {
  entry: ActiveSessionEntry
  /** 从 sessions 列表或 API 拉取到的完整 session 对象 */
  resolvedSession?: ApiSession
  /** 所属项目显示名（folderProjects 分组名），缺省时回退目录 basename */
  projectLabel?: string
  isSelected: boolean
  onSelect: (session: ApiSession) => void
}

export function ActiveSessionItem({ entry, resolvedSession, projectLabel, isSelected, onSelect }: ActiveSessionItemProps) {
  const { t } = useTranslation(['chat', 'common'])
  const isRetry = entry.status.type === 'retry'
  const pending = entry.pendingAction
  // 标题优先从 resolvedSession 取，然后 fallback 到 entry.title（sessionMeta），最后截取 ID
  const displayTitle = resolvedSession?.title || entry.title || entry.sessionId.slice(0, 12) + '...'
  // 目录优先从 resolvedSession 取
  const directory = resolvedSession?.directory || entry.directory

  // 状态显示：permission > question > retry > backgroundBusy > awaitingReview > working
  const statusConfig =
    pending?.type === 'permission'
      ? {
          label: t('activeSession.awaitingPermission'),
          color: 'text-warning-100',
          dotColor: 'bg-warning-100',
          pulse: false,
        }
      : pending?.type === 'question'
        ? { label: t('activeSession.awaitingAnswer'), color: 'text-info-100', dotColor: 'bg-info-100', pulse: false }
        : isRetry
          ? { label: t('activeSession.retrying'), color: 'text-warning-100', dotColor: 'bg-warning-100', pulse: false }
          : entry.backgroundBusy
            ? {
                label: t('activeSession.backgroundWorking'),
                color: 'text-success-100',
                dotColor: 'bg-success-100',
                pulse: true,
              }
            : entry.status.type === 'idle'
              ? {
                  label: t('activeSession.awaitingReview'),
                  color: 'text-accent-main-100',
                  dotColor: 'bg-accent-main-100',
                  pulse: false,
                }
              : { label: t('activeSession.working'), color: 'text-success-100', dotColor: 'bg-success-100', pulse: true }

  const handleClick = () => {
    if (resolvedSession) {
      onSelect(resolvedSession)
    }
    // 如果没有 resolvedSession（极端情况：API 拉取失败），不做任何事
    // 用户可以等 session 数据加载完，或从 Recents tab 找到
  }

  // 拖拽到主信息流进行分屏 / 替换会话
  const isDraggable = !!resolvedSession
  const handlePointerDragStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDraggable) return
    startInternalDrag(
      e,
      {
        kind: 'session',
        sessionId: entry.sessionId,
        directory,
      },
    )
  }

  // 状态 label 的 title：pending 描述 + 重试次数（单行放不下长文本，收进 tooltip）
  const statusTitle = [
    pending?.description,
    isRetry && entry.status.type === 'retry'
      ? t('activeSession.attempt', { count: entry.status.attempt })
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={`group relative flex items-center gap-2 px-2 py-1.5 rounded-md cursor-default transition-colors duration-150 select-none ${
        isSelected ? 'bg-bg-200/80 text-text-100' : 'text-text-300 hover:bg-bg-200/40 hover:text-text-200'
      } ${!resolvedSession ? 'opacity-50' : ''}`}
    >
      {/* 活跃状态圆点 */}
      <span className="relative shrink-0 flex items-center justify-center size-5" title={statusConfig.label}>
        <span className={`absolute w-1.5 h-1.5 rounded-full ${statusConfig.dotColor}`} />
        {statusConfig.pulse && (
          <span className={`absolute w-1.5 h-1.5 rounded-full ${statusConfig.dotColor} animate-ping opacity-50`} />
        )}
      </span>

      <button
        type="button"
        onPointerDown={handlePointerDragStart}
        onClick={handleClick}
        className="peer flex min-w-0 flex-1 items-center gap-1.5 bg-transparent border-none p-0 text-left select-none"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {/* 标题 */}
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]" title={displayTitle}>
            {displayTitle}
          </span>

          {/* 右侧 meta */}
          <div className="shrink-0 flex items-center gap-1.5 text-[length:var(--fs-xxs)] text-text-500">
            <span
              className={`shrink-0 whitespace-nowrap ${statusConfig.color}`}
              title={statusTitle || undefined}
            >
              {statusConfig.label}
            </span>
            {projectLabel && (
              <span
                className="shrink-0 max-w-24 truncate rounded bg-bg-200/60 px-1 py-px text-[length:var(--fs-xxs)] text-text-400"
                title={directory}
              >
                {projectLabel}
              </span>
            )}
          </div>
        </div>
      </button>
    </div>
  )
}

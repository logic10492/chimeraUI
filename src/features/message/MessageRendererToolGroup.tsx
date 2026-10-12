import { memo, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, ChevronRightIcon } from '../../components/Icons'
import { SmoothHeight } from '../../components/ui'
import { useDelayedRender } from '../../hooks/useDelayedRender'
import { useDisclosureScrollLock } from '../../hooks/useDisclosureScrollLock'
import { useTheme } from '../../hooks/useTheme'
import {
  useInlineToolRequests,
  findPermissionRequestForTool,
  findQuestionRequestForTool,
} from '../chat/InlineToolRequestContext'
import { ToolPartView } from './parts/ToolPartView'
import { StepFinishPartView } from './parts/StepFinishPartView'
import { extractToolData } from './tools/registry'
import { useUiDisclosureState } from '../../utils/uiDisclosureState'
import {
  buildDescriptiveToolStepsSummary,
  computePartDiffStats,
  formatTokens,
  getTaskChildSessionId,
  isReadableTool,
  isToolPartActive,
} from './MessageRenderer.utils'
import type { ToolGroupProps } from './MessageRenderer.types'

export const ToolGroup = memo(function ToolGroup({
  parts,
  stepFinish,
  duration,
  turnDuration,
  isStreaming,
  agent,
  modelLabel,
  completedAt,
}: ToolGroupProps) {
  const { t } = useTranslation('message')
  const { descriptiveToolSteps, inlineToolRequests, immersiveMode } = useTheme()
  const { pendingPermissions, pendingQuestions } = useInlineToolRequests()
  const hasPendingInteraction =
    inlineToolRequests &&
    parts.some(part => {
      const childSessionId = getTaskChildSessionId(part)
      return (
        findPermissionRequestForTool(pendingPermissions, part.callID, childSessionId) ||
        findQuestionRequestForTool(pendingQuestions, part.callID, childSessionId)
      )
    })

  const doneCount = parts.filter(p => p.state.status === 'completed').length
  const totalCount = parts.length
  const isAllDone = doneCount === totalCount
  const hasActiveTools = parts.some(isToolPartActive)
  const stepsSummary = descriptiveToolSteps ? buildDescriptiveToolStepsSummary(parts, t) : undefined

  // 汇总所有成功完成的工具的 diff stats（失败的不算）
  const totalDiffStats = useMemo(() => {
    if (!descriptiveToolSteps) return undefined
    let additions = 0,
      deletions = 0
    for (const part of parts) {
      if (part.state.status === 'error') continue
      const data = extractToolData(part)
      const stats = data.diffStats || computePartDiffStats(data)
      if (stats) {
        additions += stats.additions
        deletions += stats.deletions
      }
    }
    return additions || deletions ? { additions, deletions } : undefined
  }, [descriptiveToolSteps, parts])

  // 沉浸模式下：判断工具组是否包含需要用户阅读的工具
  const hasReadableTools = immersiveMode && parts.some(p => isReadableTool(p.tool))
  const shouldStartExpanded =
    !descriptiveToolSteps ||
    hasActiveTools ||
    hasPendingInteraction ||
    (immersiveMode && !!isStreaming && hasReadableTools)

  // descriptive 模式默认收起，运行时展开，完成后保持展开
  // 沉浸模式下：没有可读工具则完成后自动收起
  const groupStateKey = `message:${parts[0]?.messageID || 'unknown'}:tool-group:${parts[0]?.id || 'empty'}`
  const [expanded, setExpanded] = useUiDisclosureState(groupStateKey, shouldStartExpanded)
  const hasAutoExpandedReadableRef = useRef(shouldStartExpanded && immersiveMode && hasReadableTools)
  const { rootRef: stepsRootRef, headerRef: stepsHeaderRef, withScrollLock: withStepsScrollLock } =
    useDisclosureScrollLock()

  useEffect(() => {
    if (!descriptiveToolSteps) return
    // 沉浸模式下没有可读工具：始终收起，不展开
    if (immersiveMode && !hasReadableTools) {
      setExpanded(false, { touched: false, respectUser: true })
      return
    }
    if (hasActiveTools || hasPendingInteraction) {
      if (immersiveMode && hasReadableTools) {
        hasAutoExpandedReadableRef.current = true
      }
      setExpanded(true, { touched: false, respectUser: true })
      return
    }
    // 某些可读工具（如 todo）可能首帧已完成，错过 running 态；流仍在继续时也自动展开一次
    if (immersiveMode && isStreaming && hasReadableTools && !hasAutoExpandedReadableRef.current) {
      hasAutoExpandedReadableRef.current = true
      setExpanded(true, { touched: false, respectUser: true })
    }
  }, [
    descriptiveToolSteps,
    hasActiveTools,
    hasPendingInteraction,
    immersiveMode,
    hasReadableTools,
    isStreaming,
    setExpanded,
  ])

  const effectiveExpanded = expanded || hasPendingInteraction
  const shouldRenderBody = useDelayedRender(effectiveExpanded)

  // compact: 单工具时用紧凑布局（图标内联，无 timeline 连接线）
  // 不区分 streaming 状态 — 单工具始终 compact，第二个工具到来时再自然过渡到 timeline
  const isSingleCompact = totalCount === 1 && !descriptiveToolSteps
  // steps header: 多工具始终显示；描述型 steps 模式下，单工具也显示
  const showStepsHeader = totalCount > 1 || descriptiveToolSteps

  // 统一容器结构 — ToolPartView 始终在同一 React 树位置，
  // streaming→idle / 1→N 工具切换时不 remount，expanded 状态不丢失
  return (
    <SmoothHeight isActive={!!isStreaming}>
      <div ref={stepsRootRef} className="flex flex-col">
        {showStepsHeader &&
          (descriptiveToolSteps ? (
            <button
              type="button"
              ref={stepsHeaderRef}
              onClick={() => withStepsScrollLock(() => setExpanded(!expanded))}
              className="flex w-full items-baseline rounded-md py-1 text-left hover:bg-bg-200/30 transition-colors"
            >
              <span className="text-[length:var(--fs-sm)] leading-5">
                {stepsSummary?.map((seg, i) => (
                  <span
                    key={i}
                    className={
                      seg.type === 'error'
                        ? 'text-danger-100'
                        : seg.type === 'active'
                          ? 'reasoning-shimmer-text'
                          : 'text-text-300'
                    }
                  >
                    {seg.text}
                  </span>
                ))}
              </span>
              {totalDiffStats && !hasActiveTools && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-[length:var(--fs-xxs)] font-mono font-medium tabular-nums">
                  {totalDiffStats.additions > 0 && (
                    <span className="text-success-100">+{totalDiffStats.additions}</span>
                  )}
                  {totalDiffStats.deletions > 0 && <span className="text-danger-100">-{totalDiffStats.deletions}</span>}
                </span>
              )}
            </button>
          ) : (
            <button
              type="button"
              ref={stepsHeaderRef}
              onClick={() => withStepsScrollLock(() => setExpanded(!expanded))}
              className="flex items-center gap-1.5 py-1.5 text-text-400 text-[length:var(--fs-base)] hover:text-text-200 hover:bg-bg-200/30 rounded-md transition-colors"
            >
              <span className="inline-flex w-[14px] items-center justify-center shrink-0">
                {effectiveExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              </span>
              <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
                <span className="text-[length:var(--fs-md)] font-medium leading-tight">
                  {isAllDone
                    ? t('stepsCount', { done: totalCount, total: totalCount })
                    : t('stepsCount', { done: doneCount, total: totalCount })}
                </span>
                {!effectiveExpanded && stepFinish && (
                  <span className="text-[length:var(--fs-sm)] text-text-500 font-mono opacity-70">
                    {formatTokens(stepFinish.tokens, t)}
                  </span>
                )}
              </span>
            </button>
          ))}

        <div
          className={
            showStepsHeader
              ? `grid transition-[grid-template-rows] duration-300 ease-in-out ${effectiveExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`
              : ''
          }
        >
          <div
            className={showStepsHeader ? 'flex flex-col min-h-0 min-w-0 overflow-hidden' : 'flex flex-col'}
            style={showStepsHeader ? { clipPath: 'inset(0 -100% 0 -100%)' } : undefined}
          >
            {(!showStepsHeader || shouldRenderBody) &&
              parts.map((part, idx) => (
                <ToolPartView
                  key={part.id}
                  part={part}
                  isFirst={idx === 0}
                  isLast={idx === parts.length - 1}
                  compact={isSingleCompact}
                  descriptive={descriptiveToolSteps}
                  isStreaming={isStreaming}
                />
              ))}
          </div>
        </div>

        {stepFinish && (
          <div className="mt-2">
            <StepFinishPartView
              part={stepFinish}
              duration={duration}
              turnDuration={turnDuration}
              agent={agent}
              modelLabel={modelLabel}
              completedAt={completedAt}
            />
          </div>
        )}
      </div>
    </SmoothHeight>
  )
})
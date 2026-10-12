import { memo, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { animate } from 'motion/mini'
import { ChevronDownIcon, ChevronRightIcon, SplitIcon, SpinnerIcon, UndoIcon } from '../../components/Icons'
import { CopyButton, SmoothHeight } from '../../components/ui'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { useDelayedRender } from '../../hooks/useDelayedRender'
import { useDisclosureScrollLock } from '../../hooks/useDisclosureScrollLock'
import { useTheme } from '../../hooks/useTheme'
import {
  useInlineToolRequests,
  findPermissionRequestForTool,
  findQuestionRequestForTool,
} from '../chat/InlineToolRequestContext'
import { TextPartView } from './parts/TextPartView'
import { ReasoningPartView } from './parts/ReasoningPartView'
import { ToolPartView } from './parts/ToolPartView'
import { FilePartView, AgentPartView, SyntheticTextPartView } from './parts/AttachmentPartViews'
import { StepFinishPartView } from './parts/StepFinishPartView'
import { SubtaskPartView } from './parts/SubtaskPartView'
import { RetryPartView, CompactionPartView } from './parts/SystemPartViews'
import { MessageErrorView } from './parts/MessageErrorView'
import { extractToolData } from './tools/registry'
import type {
  Message,
  TextPart,
  FilePart,
  AgentPart,
  CompactionPart,
  AssistantMessageInfo,
} from '../../types/message'
import { formatDuration, formatCompletedAt, formatDetailedDateTime } from '../../utils/formatUtils'
import { useUiDisclosureState } from '../../utils/uiDisclosureState'
import type {
  ForkActionButtonProps,
  MessageRendererProps,
  RenderItem,
  ToolGroupProps,
  UserMessageViewProps,
} from './MessageRenderer.types'
import {
  COLLAPSE_PREVIEW_LINES,
  LEADING_RELAXED,
  USER_HTML_ARTIFACT_PATTERN,
  buildDescriptiveToolStepsSummary,
  computePartDiffStats,
  formatTokens,
  getTaskChildSessionId,
  groupPartsForRender,
  isReadableTool,
  isToolPartActive,
} from './MessageRenderer.utils'

export const MessageRenderer = memo(function MessageRenderer({
  message,
  allowStreamingLayoutAnimation = false,
  turnDuration,
  onUndo,
  onFork,
  forkMessageId,
  canUndo,
  onEnsureParts,
}: MessageRendererProps) {
  const { info } = message
  const isUser = info.role === 'user'

  if (isUser) {
    return (
      <UserMessageView
        message={message}
        onUndo={onUndo}
        onFork={onFork}
        forkMessageId={forkMessageId}
        canUndo={canUndo}
      />
    )
  }

  return (
    <AssistantMessageView
      message={message}
      allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
      turnDuration={turnDuration}
      onFork={onFork}
      forkMessageId={forkMessageId}
      onEnsureParts={onEnsureParts}
    />
  )
})

// ============================================
// 入场生长动画 hook — 新消息作为对话流的延续，从 height 0 平滑展开
// ============================================

function useEntryGrowAnimation(created: number) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || Date.now() - created > 3000) return
    // 始终把 DOM 还原干净：StrictMode 开发期会双调用 effect（mount→cleanup→mount），
    // 第一次的 WAAPI 动画若不被真正 cancel，会在后台跑完并把固定 height 写回 DOM
    const clear = () => {
      el.style.height = ''
      el.style.clipPath = ''
    }
    const targetHeight = el.scrollHeight
    el.style.height = '0px'
    el.style.clipPath = 'inset(0 -100% 0 -100%)'
    const controls = animate(el, { height: `${targetHeight}px` }, { duration: 0.2, ease: 'easeOut' })
    controls.then(clear)
    return () => {
      // 真停掉动画，避免后台残留写入；再兜底清一次 DOM
      controls.stop()
      clear()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}

// ============================================
// Collapsible User Text
// ============================================

// 折叠状态缓存：消息是否溢出
const overflowStateCache = new Map<string, boolean>()

const CollapsibleUserText = memo(function CollapsibleUserText({
  text,
  collapseEnabled,
  renderMarkdown,
  messageId,
}: {
  text: string
  collapseEnabled: boolean
  renderMarkdown: boolean
  messageId: string
}) {
  const { t } = useTranslation('message')
  const contentRef = useRef<HTMLDivElement>(null)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()
  const overflowCacheKey = `${messageId}:${renderMarkdown ? 'markdown' : 'plain'}`
  const [expanded, setExpanded] = useUiDisclosureState(`message:${messageId}:user-text`, false)
  const [isOverflow, setIsOverflow] = useState(() => overflowStateCache.get(overflowCacheKey) ?? false)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return

    let disposed = false
    const measure = () => {
      if (disposed) return
      const fsBase = Number.parseFloat(window.getComputedStyle(el).getPropertyValue('--fs-base'))
      if (!Number.isFinite(fsBase) || fsBase <= 0) return
      const collapsedHeight = fsBase * LEADING_RELAXED * COLLAPSE_PREVIEW_LINES
      const next = el.scrollHeight > collapsedHeight + 1
      overflowStateCache.set(overflowCacheKey, next)
      setIsOverflow(prev => (prev === next ? prev : next))
    }

    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(el)
    document.fonts?.ready?.then(measure)

    return () => {
      disposed = true
      resizeObserver.disconnect()
    }
  }, [text, overflowCacheKey])

  const hasHtmlArtifact = renderMarkdown && USER_HTML_ARTIFACT_PATTERN.test(text)
  const showCollapse = collapseEnabled && !hasHtmlArtifact && isOverflow
  const isCollapsed = collapseEnabled && !hasHtmlArtifact && !expanded

  return (
    <div ref={rootRef} className={`px-4 py-2.5 bg-bg-300 rounded-2xl max-w-full ${hasHtmlArtifact ? 'w-full max-w-2xl' : ''}`}>
      <div className="relative">
        <div
          ref={node => {
            contentRef.current = node
            headerRef(node)
          }}
          className={`m-0 break-words text-[length:var(--fs-base)] text-text-100 leading-relaxed${
            renderMarkdown ? '' : ' whitespace-pre-wrap'
          }${
            isCollapsed ? ' overflow-hidden' : ''
          }`}
          style={
            isCollapsed
              ? {
                  maxHeight: `calc(var(--fs-base) * ${LEADING_RELAXED} * ${COLLAPSE_PREVIEW_LINES})`,
                  contain: 'layout paint',
                }
              : undefined
          }
        >
          {renderMarkdown ? <MarkdownRenderer content={text} /> : text}
        </div>
        {/* 底部渐变遮罩 */}
        {showCollapse && isCollapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg-300 to-transparent pointer-events-none" />
        )}
      </div>
      {showCollapse && (
        <button
          type="button"
          onClick={() => withScrollLock(() => setExpanded(prev => !prev))}
          className="mt-1 text-[length:var(--fs-sm)] text-text-400 hover:text-text-200 transition-colors"
          aria-expanded={expanded}
        >
          {expanded ? t('showLess') : t('showMore')}
        </button>
      )}
    </div>
  )
})

const ForkActionButton = memo(function ForkActionButton({ message, onFork, forkMessageId }: ForkActionButtonProps) {
  const { t } = useTranslation('message')
  const [isForking, setIsForking] = useState(false)

  const handleFork = useCallback(async () => {
    if (!onFork || isForking) return

    setIsForking(true)

    try {
      await onFork(message, forkMessageId)
    } catch {
      // 业务错误由上层统一处理
    } finally {
      setIsForking(false)
    }
  }, [forkMessageId, isForking, message, onFork])

  if (!onFork) return null

  return (
    <button
      onClick={() => void handleFork()}
      disabled={isForking}
      className="p-1.5 rounded-md transition-colors duration-150 text-text-400 hover:text-text-200 disabled:cursor-default disabled:text-text-500"
      title={isForking ? t('forkingFromHere') : t('forkFromHere')}
      aria-label={isForking ? t('forkingFromHere') : t('forkFromHere')}
    >
      {isForking ? <SpinnerIcon className="animate-spin" /> : <SplitIcon />}
    </button>
  )
})

// ============================================
// User Message View
// ============================================

const UserMessageView = memo(function UserMessageView({
  message,
  onUndo,
  onFork,
  forkMessageId,
  canUndo,
}: UserMessageViewProps) {
  const { t } = useTranslation('message')
  const { parts, info } = message
  const [showSystemContext, setShowSystemContext] = useUiDisclosureState(
    `message:${info.id}:user-system-context`,
    false,
  )
  const shouldRenderSystemContext = useDelayedRender(showSystemContext)
  const {
    rootRef: systemContextRootRef,
    headerRef: systemContextHeaderRef,
    withScrollLock: withSystemContextScrollLock,
  } = useDisclosureScrollLock()
  const { collapseUserMessages, renderUserMarkdown } = useTheme()

  const wrapperRef = useEntryGrowAnimation(info.time.created)

  // 分离不同类型的 parts
  const textParts = parts.filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
  const syntheticParts = parts.filter((p): p is TextPart => p.type === 'text' && !!p.synthetic)
  const fileParts = parts.filter((p): p is FilePart => p.type === 'file')
  const agentParts = parts.filter((p): p is AgentPart => p.type === 'agent')
  const compactionParts = parts.filter((p): p is CompactionPart => p.type === 'compaction')

  const hasSystemContext = syntheticParts.length > 0
  const messageText = textParts.map(p => p.text).join('')
  const hasUserHtmlArtifact = renderUserMarkdown && USER_HTML_ARTIFACT_PATTERN.test(messageText)

  return (
    <div
      ref={wrapperRef}
      data-user-html-artifact={hasUserHtmlArtifact ? '' : undefined}
      className={`flex flex-col items-end group ${hasUserHtmlArtifact ? 'w-full' : ''}`}
    >
      <div className="flex flex-col gap-1 items-end w-full">
        {/* 消息文本 */}
        {messageText && (
          <CollapsibleUserText
            text={messageText}
            collapseEnabled={collapseUserMessages}
            renderMarkdown={renderUserMarkdown}
            messageId={info.id}
          />
        )}

        {/* 用户附件 */}
        {(fileParts.length > 0 || agentParts.length > 0) && (
          <div className="mt-1 flex max-w-full min-w-0 flex-wrap gap-2 justify-end">
            {fileParts.map(part => (
              <FilePartView key={part.id} part={part} />
            ))}
            {agentParts.map(part => (
              <AgentPartView key={part.id} part={part} />
            ))}
          </div>
        )}

        {/* 系统上下文 */}
        {hasSystemContext && (
          <div ref={systemContextRootRef} className="flex flex-col items-end mt-1 w-full">
            <button
              type="button"
              ref={systemContextHeaderRef}
              onClick={() => withSystemContextScrollLock(() => setShowSystemContext(!showSystemContext))}
              className="flex items-center gap-1 text-[length:var(--fs-sm)] text-text-400 hover:text-text-300 transition-colors py-1 px-2 rounded hover:bg-bg-200"
            >
              <span>
                {showSystemContext ? t('hideSystemContext') : t('showSystemContext', { count: syntheticParts.length })}
              </span>
              <span className={`transition-transform duration-300 ${showSystemContext ? '' : '-rotate-90'}`}>
                <ChevronDownIcon size={10} />
              </span>
            </button>

            <div
              className={`grid w-full transition-[grid-template-rows,opacity] duration-300 ease-out ${
                showSystemContext ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                {shouldRenderSystemContext && (
                  <div className="pt-2 flex max-w-full min-w-0 flex-wrap gap-2 justify-end">
                    {syntheticParts.map(part => (
                      <SyntheticTextPartView key={part.id} part={part} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {compactionParts.length > 0 && (
          <div className="w-full mt-1">
            {compactionParts.map(part => (
              <CompactionPartView key={part.id} part={part} />
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 [@media(any-pointer:coarse)]:opacity-100 transition-opacity">
          {/* Undo button */}
          {canUndo && onUndo && (
            <button
              onClick={() => onUndo(info.id)}
              className="p-1.5 rounded-md transition-colors duration-150 text-text-400 hover:text-text-200"
              title={t('undoFromHere')}
            >
              <UndoIcon />
            </button>
          )}
          <ForkActionButton message={message} onFork={onFork} forkMessageId={forkMessageId} />
          {/* Copy button */}
          {messageText && <CopyButton text={messageText} position="static" />}
        </div>
      </div>
    </div>
  )
})

// ============================================
// Assistant Message View
// ============================================

const AssistantMessageView = memo(function AssistantMessageView({
  message,
  allowStreamingLayoutAnimation = false,
  turnDuration,
  onFork,
  forkMessageId,
  onEnsureParts,
}: {
  message: Message
  allowStreamingLayoutAnimation?: boolean
  turnDuration?: number
  onFork?: (message: Message, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
  onEnsureParts?: (messageId: string) => void
}) {
  const { t } = useTranslation('message')
  const { parts, isStreaming, info } = message
  const { stepFinishDisplay, completedAtFormat } = useTheme()

  const wrapperRef = useEntryGrowAnimation(info.time.created)

  useEffect(() => {
    if (parts.length === 0 && onEnsureParts) {
      onEnsureParts(message.info.id)
    }
  }, [parts.length, onEnsureParts, message.info.id])

  // 收集连续的 tool parts 合并渲染
  const renderItems = useMemo(() => groupPartsForRender(parts), [parts])

  // 判断哪些 reasoning part 已经结束（后面出现了任何非基础设施 part）
  // 直接检查源 parts 数组，而非 renderItems，因为 renderItems 会过滤掉空 text，
  // 但空 text part 的存在本身就说明模型已经进入了下一输出阶段
  const endedReasoningIds = useMemo(() => {
    const ended = new Set<string>()
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type !== 'reasoning') continue
      for (let j = i + 1; j < parts.length; j++) {
        const t = parts[j].type
        // snapshot/patch 是纯内部状态，不代表内容流转
        if (t === 'snapshot' || t === 'patch') continue
        // 任何其他 part 类型（包括空 text、step-start、tool 等）都说明思考已结束
        ended.add(parts[i].id)
        break
      }
    }
    return ended
  }, [parts])

  // 计算完整文本用于复制
  const fullText = parts
    .filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
    .map(p => p.text)
    .join('')
  const hasCopyableText = fullText.trim().length > 0

  // 检查消息级别错误
  const messageError = (info as AssistantMessageInfo).error

  // 消息总耗时
  const { created, completed } = info.time
  const duration = completed != null ? completed - created : undefined

  // agent / model（仅 assistant 消息）
  const assistantInfo = info.role === 'assistant' ? (info as AssistantMessageInfo) : null
  const agent = assistantInfo?.agent || undefined
  const modelLabel = assistantInfo?.modelID || undefined

  const hasStepFinishPart = parts.some(part => part.type === 'step-finish')
  const showTurnDurationFooter =
    !isStreaming && !hasStepFinishPart && stepFinishDisplay.turnDuration && turnDuration != null && turnDuration > 0
  const showCompletedAtFooter = !isStreaming && !hasStepFinishPart && stepFinishDisplay.completedAt && completed != null

  if (!isStreaming && parts.length === 0) {
    // 有错误时直接显示错误信息
    if (messageError) {
      return (
        <div className="flex flex-col gap-2 w-full">
          <MessageErrorView error={messageError} stateKey={`message:${message.info.id}:error`} />
        </div>
      )
    }
    // parts 尚未 hydrate — 保留最小占位减少 CLS，不显示骨架/loading 文字
    // onEnsureParts 已在上方 useEffect 中触发 hydrate，parts 到位后自动 re-render
    return <div className="w-full min-h-[40px]" />
  }

  return (
    <div ref={wrapperRef} className="flex flex-col gap-2 w-full group">
      {/* 流式增高走自然撑开 + 贴底 scroll，默认不做 height 补间，避免每帧 layout/remeasure */}
      <SmoothHeight isActive={!!isStreaming && allowStreamingLayoutAnimation}>
        <div className="flex flex-col gap-2">
          {renderItems.map((item: RenderItem, idx: number) => {
            // 耗时只在最后一个含 stepFinish 的 item 上显示
            const isLastStepFinish =
              idx ===
              renderItems.findLastIndex(it =>
                it.type === 'tool-group' ? !!it.stepFinish : it.part.type === 'step-finish',
              )

            if (item.type === 'tool-group') {
              return (
                <ToolGroup
                  key={item.parts[0].id}
                  parts={item.parts}
                  stepFinish={item.stepFinish}
                  duration={isLastStepFinish ? duration : undefined}
                  turnDuration={isLastStepFinish ? turnDuration : undefined}
                  isStreaming={isStreaming}
                  agent={agent}
                  modelLabel={modelLabel}
                  completedAt={isLastStepFinish ? completed : undefined}
                />
              )
            }

            const part = item.part
            switch (part.type) {
              case 'text':
                return <TextPartView key={part.id} part={part} isStreaming={isStreaming} />
              case 'reasoning': {
                const reasoningDone = endedReasoningIds.has(part.id)
                return <ReasoningPartView key={part.id} part={part} isStreaming={isStreaming && !reasoningDone} />
              }
              case 'step-finish':
                return (
                  <StepFinishPartView
                    key={part.id}
                    part={part}
                    duration={isLastStepFinish ? duration : undefined}
                    turnDuration={isLastStepFinish ? turnDuration : undefined}
                    agent={agent}
                    modelLabel={modelLabel}
                    completedAt={isLastStepFinish ? completed : undefined}
                  />
                )
              case 'subtask':
                return <SubtaskPartView key={part.id} part={part} />
              case 'retry':
                return <RetryPartView key={part.id} part={part} />
              case 'compaction':
                return <CompactionPartView key={part.id} part={part} />
              default:
                return null
            }
          })}
        </div>
      </SmoothHeight>

      {/* Message-level error */}
      {messageError && <MessageErrorView error={messageError} stateKey={`message:${info.id}:error`} />}

      {(showTurnDurationFooter || showCompletedAtFooter) && (
        <div className="flex items-center gap-3 py-0.5 text-[length:var(--fs-xxs)] text-text-500">
          {showTurnDurationFooter && (
            <span>{t('stepFinish.totalDuration', { duration: formatDuration(turnDuration!) })}</span>
          )}
          {showCompletedAtFooter && (
            <span title={formatDetailedDateTime(completed!)}>{formatCompletedAt(completed!, completedAtFormat)}</span>
          )}
        </div>
      )}

      {hasCopyableText && (
        <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 [@media(any-pointer:coarse)]:opacity-100 transition-opacity">
          <ForkActionButton message={message} onFork={onFork} forkMessageId={forkMessageId} />
          <CopyButton text={fullText} position="static" />
        </div>
      )}
    </div>
  )
})

// ============================================
// Tool Group (连续的 tool parts)
// ============================================

const ToolGroup = memo(function ToolGroup({
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

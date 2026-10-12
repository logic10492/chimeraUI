import { memo, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton, SmoothHeight } from '../../components/ui'
import { useTheme } from '../../hooks/useTheme'
import type { Message, TextPart, AssistantMessageInfo } from '../../types/message'
import { formatDuration, formatCompletedAt, formatDetailedDateTime } from '../../utils/formatUtils'
import { TextPartView } from './parts/TextPartView'
import { ReasoningPartView } from './parts/ReasoningPartView'
import { StepFinishPartView } from './parts/StepFinishPartView'
import { SubtaskPartView } from './parts/SubtaskPartView'
import { RetryPartView, CompactionPartView } from './parts/SystemPartViews'
import { MessageErrorView } from './parts/MessageErrorView'
import { useEntryGrowAnimation } from './MessageRenderer.hooks'
import { ToolGroup } from './MessageRendererToolGroup'
import { ForkActionButton } from './MessageRendererForkActionButton'
import { groupPartsForRender } from './MessageRenderer.utils'
import type { RenderItem } from './MessageRenderer.types'

export interface AssistantMessageViewProps {
  message: Message
  allowStreamingLayoutAnimation?: boolean
  turnDuration?: number
  onFork?: (message: Message, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
  onEnsureParts?: (messageId: string) => void
}

export const AssistantMessageView = memo(function AssistantMessageView({
  message,
  allowStreamingLayoutAnimation = false,
  turnDuration,
  onFork,
  forkMessageId,
  onEnsureParts,
}: AssistantMessageViewProps) {
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
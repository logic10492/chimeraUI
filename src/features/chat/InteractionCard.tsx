/**
 * InteractionCard — 统一的工具交互卡片
 *
 * 审批（permission）与问答（question）合一的单一交互模型。
 * 同一组件挂载在两种位置，交互与数据流完全一致：
 *  - variant="inline"：内嵌在对应工具卡片下方（ToolPartView / SwarmRenderer）
 *  - variant="stack"：未匹配到工具卡片（或内联关闭）时，堆叠在消息流底部
 *
 * 数据流走同一条路径（InlineToolRequestContext + usePermissionHandler）。
 */

import { memo, useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  PermissionRequest as ApiPermissionRequest,
  QuestionRequest as ApiQuestionRequest,
  QuestionInfo as ApiQuestionInfo,
  PermissionReply,
  QuestionAnswer,
} from '../../types/api/permission'
import { ContentBlock } from '../../components/ContentBlock'
import { PermissionListIcon, QuestionIcon, UsersIcon, CheckIcon, ChevronDownIcon, ReturnIcon } from '../../components/Icons'
import { childSessionStore } from '../../store/childSessionStore'
import { autoApproveStore } from '../../store/autoApproveStore'
import { themeStore } from '../../store/themeStore'
import { keybindingStore, matchesKeybinding } from '../../store/keybindingStore'
import { usePresence } from '../../hooks/usePresence'
import { useChatViewport } from './chatViewport'

type InteractionVariant = 'inline' | 'stack'

interface InteractionCardProps {
  /** 挂载位置：内嵌工具卡片 / 消息流底部堆叠 */
  variant?: InteractionVariant
  /** 审批请求（与 question 二选一） */
  permission?: ApiPermissionRequest
  /** 问答请求（与 permission 二选一） */
  question?: ApiQuestionRequest
  onPermissionReply: (requestId: string, reply: PermissionReply) => void
  onQuestionReply: (requestId: string, answers: QuestionAnswer[]) => void
  onQuestionReject: (requestId: string) => void
  isReplying: boolean
  /** 内联：权限已批准但工具还没完成，保留渲染避免跳动 */
  resolved?: boolean
  /** 内联：ToolBody 已渲染内容时隐藏权限内容区，只显示操作按钮 */
  contentHidden?: boolean
  /** 堆叠：队列中的请求数量 */
  queueLength?: number
  /** 堆叠：折叠状态 */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  /** 堆叠：当前主 session ID，用于判断是否来自子 agent */
  currentSessionId?: string | null
}

export const InteractionCard = memo(function InteractionCard(props: InteractionCardProps) {
  if (props.variant === 'stack') return <StackCard {...props} />
  return <InlineCard {...props} />
})

// ============================================
// Inline — 内嵌在工具卡片下方
// ============================================

function InlineCard({ permission, question, onPermissionReply, onQuestionReply, onQuestionReject, isReplying, resolved = false, contentHidden = false }: InteractionCardProps) {
  const { t } = useTranslation(['chat', 'common'])
  const compact = useToolCardCompact()
  if (question) {
    return (
      <QuestionContent
        request={question}
        onReply={onQuestionReply}
        onReject={onQuestionReject}
        isReplying={isReplying}
      />
    )
  }
  if (!permission) return null
  return (
    <div className="space-y-2">
      <PermissionContent request={permission} contentHidden={contentHidden} compact={compact} />
      {resolved ? (
        <div className="flex items-center gap-2 text-[length:var(--fs-sm)] text-text-400">
          <span className="inline-block w-3 h-3 border-2 border-accent-main-100 border-t-transparent rounded-full animate-spin" />
          <span>{t('permissionDialog.applying')}</span>
        </div>
      ) : (
        <PermissionActions request={permission} onReply={onPermissionReply} isReplying={isReplying} large={false} />
      )}
    </div>
  )
}

// ============================================
// Stack — 消息流底部堆叠（覆盖审批 + 问答）
// ============================================

function StackCard({ permission, question, onPermissionReply, onQuestionReply, onQuestionReject, isReplying, queueLength = 1, collapsed = false, onCollapsedChange, currentSessionId }: InteractionCardProps) {
  const { t } = useTranslation(['chat', 'common'])
  const { presentation } = useChatViewport()
  const isCompact = presentation.isCompact
  const compact = useToolCardCompact()

  const { shouldRender, ref: animRef } = usePresence<HTMLDivElement>(!collapsed, {
    from: { opacity: 0, transform: 'translateY(16px)' },
    to: { opacity: 1, transform: 'translateY(0px)' },
    duration: 0.2,
  })

  if (!shouldRender) return null
  if (!permission && !question) return null

  const isPermission = !!permission
  const title = isPermission
    ? t('permissionDialog.permission', { permission: permission!.permission })
    : t('questionDialog.title')

  const isFromChildSession = isPermission && currentSessionId && permission!.sessionID !== currentSessionId
  const childSessionInfo = isFromChildSession ? childSessionStore.getSessionInfo(permission!.sessionID) : null

  return (
    <div ref={animRef} className="absolute bottom-0 left-0 right-0 z-[10]">
      <div
        className="mx-auto max-w-3xl pointer-events-auto transition-[max-width] duration-300 ease-in-out pb-2"
        style={{
          paddingLeft: isCompact ? 6 : 14,
          paddingRight: isCompact ? 6 : 14,
          paddingBottom: 'max(8px, var(--safe-area-inset-bottom, 8px))',
        }}
      >
        <div className="border border-border-300/40 rounded-[14px] shadow-float bg-bg-100 overflow-hidden">
          <div className="bg-bg-000 rounded-t-[14px]">
            {/* Header */}
            <div className="flex items-center justify-between py-3 px-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center text-text-100 w-5 h-5">
                  {isPermission ? <PermissionListIcon size={20} /> : <QuestionIcon />}
                </div>
                <h3 className="text-[length:var(--fs-base)] leading-none font-medium text-text-100">{title}</h3>
                {queueLength > 1 && (
                  <span className="text-[length:var(--fs-sm)] text-text-400 bg-bg-200 px-1.5 py-0.5 rounded">
                    {t('permissionDialog.moreCount', { count: queueLength - 1 })}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onCollapsedChange?.(true)}
                className="p-1 rounded-md text-text-400 hover:text-text-200 hover:bg-bg-200 transition-colors"
                title={t('permissionDialog.minimize')}
                aria-label={t('permissionDialog.minimize')}
              >
                <ChevronDownIcon size={16} />
              </button>
            </div>

            {/* Child session indicator */}
            {isFromChildSession && (
              <div className="px-4 pb-2 flex items-center gap-2">
                <UsersIcon className="w-3.5 h-3.5 text-info-100" />
                <span className="text-[length:var(--fs-sm)] text-info-100">
                  {t('permissionDialog.fromSubtask', {
                    title: childSessionInfo?.title || t('permissionDialog.subtaskFallback'),
                  })}
                </span>
              </div>
            )}

            <div className="border-t border-border-300/30" />

            {/* Content */}
            <div className="px-4 py-3 space-y-4 max-h-[45vh] overflow-y-auto custom-scrollbar">
              {permission && <PermissionContent request={permission} contentHidden={false} compact={compact} />}
              {question && (
                <QuestionContent
                  request={question}
                  onReply={onQuestionReply}
                  onReject={onQuestionReject}
                  isReplying={isReplying}
                />
              )}
            </div>

            {/* Actions */}
            {permission && (
              <div className="px-3 py-3 space-y-[6px]">
                <PermissionActions request={permission} onReply={onPermissionReply} isReplying={isReplying} large />
                <p className="text-[length:var(--fs-xs)] text-text-500 pt-1 px-1 leading-relaxed">
                  {autoApproveStore.enabled
                    ? t('permissionDialog.autoApproveEnabled')
                    : t('permissionDialog.changePermissionSettings')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Permission content + actions
// ============================================

function PermissionContent({ request, contentHidden, compact }: { request: ApiPermissionRequest; contentHidden: boolean; compact: boolean }) {
  const { t } = useTranslation(['chat', 'common'])
  if (contentHidden) return null

  const metadata = request.metadata
  const filepath = metadata?.filepath as string | undefined
  let diffData: { before: string; after: string } | string | undefined
  const rawDiff = metadata?.diff as string | undefined
  if (metadata?.filediff && typeof metadata.filediff === 'object') {
    const fd = metadata.filediff as Record<string, unknown>
    if (typeof fd.patch === 'string') diffData = fd.patch
    else if (fd.before !== undefined && fd.after !== undefined) diffData = { before: String(fd.before), after: String(fd.after) }
  }
  if (!diffData && rawDiff) diffData = rawDiff

  const isFileEdit = request.permission === 'edit' || request.permission === 'write'
  const patternsText = request.patterns?.length ? request.patterns.map(p => p.replace(/\\n/g, '\n')).join('\n\n') : ''

  return (
    <>
      {isFileEdit && diffData ? (
        <ContentBlock
          stateKey={`permission:${request.sessionID}:${request.id}:diff`}
          label={request.permission}
          filePath={filepath}
          diff={diffData}
          collapsible={false}
          compact={compact}
        />
      ) : patternsText ? (
        <ContentBlock
          stateKey={`permission:${request.sessionID}:${request.id}:patterns`}
          label={t('permissionDialog.request')}
          content={patternsText}
          language="bash"
          collapsible={false}
          compact={compact}
        />
      ) : null}

      {/* 始终允许规则（合并自浮层 PermissionDialog） */}
      {request.always && request.always.length > 0 && (
        <ContentBlock
          stateKey={`permission:${request.sessionID}:${request.id}:rule`}
          label={t('permissionDialog.rule')}
          content={request.always.join('\n')}
          language="bash"
          maxHeight={80}
          collapsible={false}
          compact={compact}
        />
      )}
    </>
  )
}

function PermissionActions({ request, onReply, isReplying, large }: { request: ApiPermissionRequest; onReply: (requestId: string, reply: PermissionReply) => void; isReplying: boolean; large: boolean }) {
  const { t } = useTranslation(['chat', 'common'])

  const handleAlways = useCallback(() => {
    if (autoApproveStore.enabled) {
      const rulePatterns = [...(request.always || []), ...(request.patterns || [])]
      const unique = [...new Set(rulePatterns)]
      if (unique.length > 0) {
        autoApproveStore.addRules(request.sessionID, request.permission, unique)
        onReply(request.id, 'once')
        return
      }
    }
    onReply(request.id, 'always')
  }, [request, onReply])

  if (!large) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => onReply(request.id, 'once')}
          disabled={isReplying}
          className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] font-medium bg-text-100 text-bg-000 hover:bg-text-200 transition-colors disabled:opacity-50"
        >
          {t('permissionDialog.allowOnce')}
        </button>
        <button
          onClick={handleAlways}
          disabled={isReplying}
          className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] text-text-300 hover:text-text-100 transition-colors disabled:opacity-50"
        >
          {t('permissionDialog.alwaysAllow')}
        </button>
        <button
          onClick={() => onReply(request.id, 'reject')}
          disabled={isReplying}
          className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] text-text-400 hover:text-danger-100 transition-colors disabled:opacity-50"
        >
          {t('common:reject')}
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => onReply(request.id, 'once')}
        disabled={isReplying}
        className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg bg-text-100 text-bg-000 hover:bg-text-200 transition-colors font-medium text-[length:var(--fs-base)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span>{isReplying ? t('common:sending') : t('permissionDialog.allowOnce')}</span>
        {!isReplying && <ReturnIcon />}
      </button>

      <button
        onClick={handleAlways}
        disabled={isReplying}
        className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg border border-border-200/50 text-text-100 hover:bg-bg-200 transition-colors text-[length:var(--fs-base)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span>{t('permissionDialog.alwaysAllow')}</span>
        <span className="text-[length:var(--fs-sm)] text-text-400">
          {autoApproveStore.enabled ? t('permissionDialog.browserSession') : t('permissionDialog.thisSession')}
        </span>
      </button>

      <button
        onClick={() => onReply(request.id, 'reject')}
        disabled={isReplying}
        className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg text-text-300 hover:bg-bg-200 transition-colors text-[length:var(--fs-base)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span>{t('common:reject')}</span>
        <span className="text-[length:var(--fs-sm)] text-text-500">Esc</span>
      </button>
    </>
  )
}

// ============================================
// Question content + actions
// ============================================

function QuestionContent({ request, onReply, onReject, isReplying }: { request: ApiQuestionRequest; onReply: (requestId: string, answers: QuestionAnswer[]) => void; onReject: (requestId: string) => void; isReplying: boolean }) {
  const { t } = useTranslation(['chat', 'common'])

  const [answers, setAnswers] = useState<Map<number, Set<string>>>(() => {
    const map = new Map<number, Set<string>>()
    request.questions.forEach((_, idx) => map.set(idx, new Set()))
    return map
  })
  const [customEnabled, setCustomEnabled] = useState<Map<number, boolean>>(() => {
    const map = new Map<number, boolean>()
    request.questions.forEach((_, idx) => map.set(idx, false))
    return map
  })
  const [customValues, setCustomValues] = useState<Map<number, string>>(() => {
    const map = new Map<number, string>()
    request.questions.forEach((_, idx) => map.set(idx, ''))
    return map
  })

  const selectOption = useCallback((qIdx: number, label: string) => {
    setAnswers(prev => new Map(prev).set(qIdx, new Set([label])))
    setCustomEnabled(prev => new Map(prev).set(qIdx, false))
  }, [])

  const selectCustom = useCallback((qIdx: number) => {
    setAnswers(prev => new Map(prev).set(qIdx, new Set()))
    setCustomEnabled(prev => new Map(prev).set(qIdx, true))
  }, [])

  const toggleOption = useCallback((qIdx: number, label: string) => {
    setAnswers(prev => {
      const s = new Set(prev.get(qIdx) || [])
      if (s.has(label)) s.delete(label)
      else s.add(label)
      return new Map(prev).set(qIdx, s)
    })
  }, [])

  const toggleCustom = useCallback((qIdx: number) => {
    setCustomEnabled(prev => new Map(prev).set(qIdx, !prev.get(qIdx)))
  }, [])

  const updateCustomValue = useCallback((qIdx: number, value: string) => {
    setCustomValues(prev => new Map(prev).set(qIdx, value))
  }, [])

  const handleSubmit = useCallback(() => {
    const result: QuestionAnswer[] = request.questions.map((q, idx) => {
      const selected = Array.from(answers.get(idx) || [])
      const isCustom = customEnabled.get(idx)
      const customValue = customValues.get(idx)?.trim()
      if (q.multiple) {
        return isCustom && customValue && q.custom !== false ? [...selected, customValue] : selected
      }
      return isCustom && customValue ? [customValue] : selected
    })
    onReply(request.id, result)
  }, [request, answers, customEnabled, customValues, onReply])

  const canSubmit = request.questions.every((_q, idx) => {
    const selected = answers.get(idx) || new Set()
    const isCustom = customEnabled.get(idx)
    const customValue = customValues.get(idx)?.trim()
    return selected.size > 0 || (isCustom && !!customValue)
  })

  // 键盘快捷键：和主输入框一致的 send keybinding 提交，Escape 跳过
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onReject(request.id)
        return
      }
      const sendKey = keybindingStore.getKey('sendMessage')
      if (sendKey && matchesKeybinding(e.nativeEvent, sendKey)) {
        e.preventDefault()
        if (canSubmit && !isReplying) handleSubmit()
      }
    },
    [onReject, request.id, canSubmit, isReplying, handleSubmit],
  )

  return (
    <div className="space-y-2" onKeyDown={handleKeyDown}>
      <div className="space-y-3">
        {request.questions.map((question, qIdx) => (
          <QuestionItem
            key={qIdx}
            question={question}
            selected={answers.get(qIdx) || new Set()}
            isCustomEnabled={customEnabled.get(qIdx) || false}
            customValue={customValues.get(qIdx) || ''}
            onSelectOption={label => selectOption(qIdx, label)}
            onSelectCustom={() => selectCustom(qIdx)}
            onToggleOption={label => toggleOption(qIdx, label)}
            onToggleCustom={() => toggleCustom(qIdx)}
            onCustomValueChange={value => updateCustomValue(qIdx, value)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || isReplying}
          className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] font-medium bg-text-100 text-bg-000 hover:bg-text-200 transition-colors disabled:opacity-50"
        >
          {t('common:submit')}
        </button>
        <button
          onClick={() => onReject(request.id)}
          disabled={isReplying}
          className="px-2.5 py-0.5 rounded text-[length:var(--fs-sm)] text-text-400 hover:text-text-200 transition-colors disabled:opacity-50"
        >
          {t('common:skip')}
        </button>
      </div>
    </div>
  )
}

// ============================================
// Question item
// ============================================

interface QuestionItemProps {
  question: ApiQuestionInfo
  selected: Set<string>
  isCustomEnabled: boolean
  customValue: string
  onSelectOption: (label: string) => void
  onSelectCustom: () => void
  onToggleOption: (label: string) => void
  onToggleCustom: () => void
  onCustomValueChange: (value: string) => void
}

function QuestionItem({
  question,
  selected,
  isCustomEnabled,
  customValue,
  onSelectOption,
  onSelectCustom,
  onToggleOption,
  onToggleCustom,
  onCustomValueChange,
}: QuestionItemProps) {
  const { t } = useTranslation('chat')
  const isMultiple = question.multiple || false
  const allowCustom = question.custom !== false
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isCustomEnabled && textareaRef.current) textareaRef.current.focus()
  }, [isCustomEnabled])

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 100)}px`
    }
  }, [])

  return (
    <div className="space-y-2">
      <div>
        {question.header && (
          <div className="text-[length:var(--fs-xs)] text-text-400 font-medium mb-0.5">{question.header}</div>
        )}
        <div className="text-[length:var(--fs-md)] text-text-100">{question.question}</div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {question.options.map((option, idx) => {
          const isSelected = selected.has(option.label)
          return (
            <button
              key={idx}
              onClick={() => (isMultiple ? onToggleOption(option.label) : onSelectOption(option.label))}
              title={option.description}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[length:var(--fs-sm)] rounded-md border transition-all ${
                isSelected
                  ? 'border-text-100 text-text-100 bg-bg-300/40'
                  : 'border-border-200/60 text-text-300 hover:border-text-400 hover:text-text-200'
              }`}
            >
              {isMultiple && (
                <span
                  className={`inline-flex w-3.5 h-3.5 rounded items-center justify-center border transition-colors ${
                    isSelected ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
                  }`}
                >
                  {isSelected && <CheckIcon size={10} />}
                </span>
              )}
              {option.label}
            </button>
          )
        })}
      </div>

      {allowCustom && (
        <div
          onClick={() => {
            if (!isCustomEnabled) {
              if (isMultiple) onToggleCustom()
              else onSelectCustom()
            }
          }}
          className={`flex items-center rounded-md border transition-colors ${
            isCustomEnabled ? 'border-text-100 bg-bg-300/20' : 'border-border-200/60 hover:border-text-400'
          }`}
        >
          {isMultiple && (
            <span
              className={`ml-2.5 inline-flex w-3.5 h-3.5 rounded items-center justify-center border shrink-0 transition-colors ${
                isCustomEnabled ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
              }`}
            >
              {isCustomEnabled && <CheckIcon size={10} />}
            </span>
          )}
          <textarea
            ref={textareaRef}
            value={customValue}
            onChange={e => {
              onCustomValueChange(e.target.value)
              adjustHeight()
            }}
            onClick={e => {
              e.stopPropagation()
              if (!isCustomEnabled) {
                if (isMultiple) onToggleCustom()
                else onSelectCustom()
              }
            }}
            placeholder={t('questionDialog.typeYourAnswer')}
            rows={1}
            className="flex-1 bg-transparent text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-500 focus:outline-none resize-none min-h-[32px] px-2.5 py-1.5 leading-relaxed"
          />
        </div>
      )}
    </div>
  )
}

// ============================================
// Shared
// ============================================

function useToolCardCompact(): boolean {
  return useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot).toolCardStyle === 'compact'
}
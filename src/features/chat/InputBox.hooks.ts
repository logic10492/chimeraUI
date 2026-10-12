// ============================================
// InputBox hooks - revert 回填 / 输入框高度预算 / textarea 自适应
// ============================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Attachment } from '../attachment/types'
import {
  TEXTAREA_MIN_HEIGHT,
  TEXTAREA_VERTICAL_CHROME,
  INPUT_TOOLBAR_FALLBACK_HEIGHT,
  INPUT_FOOTER_FALLBACK_HEIGHT,
  getComposerMaxHeight,
} from './InputBox.utils'

// DOM-touching helper: composer pane height fallback chain.
function getComposerPaneHeight(anchor: HTMLElement | null): number {
  const paneRoot = anchor?.closest<HTMLElement>('[data-chat-pane-root]')
  const paneHeight = paneRoot?.getBoundingClientRect().height
  if (paneHeight && paneHeight > 0) return paneHeight
  return window.innerHeight || 800
}

/**
 * 处理 revert 恢复：revertedText/attachments/messageId 变化时回填输入框，
 * 带身份守卫避免会话重载/重连/回滚时覆盖用户已编辑内容。
 */
export function useRevertDraftSync({
  revertedText,
  revertedAttachments,
  revertedMessageId,
  isSubmitting,
  textareaRef,
  setText,
  setAttachments,
}: {
  revertedText: string | undefined
  revertedAttachments: Attachment[] | undefined
  revertedMessageId: string | undefined
  isSubmitting: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  setText: React.Dispatch<React.SetStateAction<string>>
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
}) {
  const prevRevertedTextRef = useRef<string | undefined>(undefined)
  const appliedRevertKeyRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    let frameId: number | null = null

    if (revertedText !== undefined) {
      // 身份守卫：会话重载/SSE 重连/发送失败回滚会重建 revert history，引用变化但目标不变时
      // revertKey 相同，跳过回填以保留用户已编辑内容；首次激活或切换 revert 目标才回填
      const revertKey = `${revertedMessageId ?? ''}\u0000${revertedText}`
      if (appliedRevertKeyRef.current !== revertKey) {
        frameId = requestAnimationFrame(() => {
          appliedRevertKeyRef.current = revertKey
          setText(revertedText)
          setAttachments(revertedAttachments || [])
          // 聚焦并移动光标到末尾
          if (textareaRef.current) {
            textareaRef.current.focus()
            textareaRef.current.setSelectionRange(revertedText.length, revertedText.length)
          }
        })
      }
    } else {
      appliedRevertKeyRef.current = undefined
      if (prevRevertedTextRef.current !== undefined && !isSubmitting) {
        frameId = requestAnimationFrame(() => {
          setText('')
          setAttachments([])
        })
      }
    }

    prevRevertedTextRef.current = revertedText

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [revertedText, revertedAttachments, revertedMessageId, isSubmitting, textareaRef, setText, setAttachments])
}

/**
 * 输入框高度预算：根据 pane 高度、附件区/工具栏/footer 实际高度，
 * 计算 composer / inputContainer / textarea 三层 maxHeight。
 */
export function useComposerHeightBudget({
  attachmentsCount,
  isCollapsed,
  isCompact,
  text,
  inputContainerRef,
  contentWrapRef,
  attachmentSectionRef,
  toolbarRef,
  footerRef,
}: {
  attachmentsCount: number
  isCollapsed: boolean
  isCompact: boolean
  text: string
  inputContainerRef: RefObject<HTMLDivElement | null>
  contentWrapRef: RefObject<HTMLDivElement | null>
  attachmentSectionRef: RefObject<HTMLDivElement | null>
  toolbarRef: RefObject<HTMLDivElement | null>
  footerRef: RefObject<HTMLDivElement | null>
}) {
  const [composerMaxHeight, setComposerMaxHeight] = useState(280)
  const [inputContainerMaxHeight, setInputContainerMaxHeight] = useState(240)
  const [textareaMaxHeight, setTextareaMaxHeight] = useState(180)

  const updateComposerHeightBudget = useCallback(() => {
    const paneHeight = getComposerPaneHeight(inputContainerRef.current ?? contentWrapRef.current)
    const nextComposerMaxHeight = getComposerMaxHeight(paneHeight, isCompact)
    const attachmentHeight = attachmentsCount > 0 ? (attachmentSectionRef.current?.offsetHeight ?? 0) : 0
    const toolbarHeight = toolbarRef.current?.offsetHeight || INPUT_TOOLBAR_FALLBACK_HEIGHT
    const footerHeight = isCollapsed ? 0 : footerRef.current?.offsetHeight || INPUT_FOOTER_FALLBACK_HEIGHT
    const inputContainerChrome = attachmentHeight + toolbarHeight + TEXTAREA_VERTICAL_CHROME
    const nextInputContainerMaxHeight = Math.max(
      TEXTAREA_MIN_HEIGHT + TEXTAREA_VERTICAL_CHROME + toolbarHeight,
      nextComposerMaxHeight - footerHeight,
    )
    const nextTextareaMaxHeight = Math.max(TEXTAREA_MIN_HEIGHT, nextInputContainerMaxHeight - inputContainerChrome)

    setComposerMaxHeight(prev => (Math.abs(prev - nextComposerMaxHeight) < 1 ? prev : nextComposerMaxHeight))
    setInputContainerMaxHeight(prev =>
      Math.abs(prev - nextInputContainerMaxHeight) < 1 ? prev : nextInputContainerMaxHeight,
    )
    setTextareaMaxHeight(prev => (Math.abs(prev - nextTextareaMaxHeight) < 1 ? prev : nextTextareaMaxHeight))
  }, [attachmentsCount, isCollapsed, isCompact, inputContainerRef, contentWrapRef, attachmentSectionRef, toolbarRef, footerRef])

  useLayoutEffect(() => {
    updateComposerHeightBudget()
  }, [updateComposerHeightBudget, text])

  useEffect(() => {
    updateComposerHeightBudget()

    const observed = [
      inputContainerRef.current?.closest<HTMLElement>('[data-chat-pane-root]'),
      inputContainerRef.current,
      attachmentSectionRef.current,
      toolbarRef.current,
      footerRef.current,
    ].filter((element): element is HTMLElement => !!element)

    // 同帧多次 RO/resize 合并为一次高度预算计算，避免布局连环读
    let budgetRaf: number | null = null
    const scheduleBudgetUpdate = () => {
      if (budgetRaf !== null) return
      budgetRaf = requestAnimationFrame(() => {
        budgetRaf = null
        updateComposerHeightBudget()
      })
    }

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleBudgetUpdate) : null
    observed.forEach(element => observer?.observe(element))
    window.addEventListener('resize', scheduleBudgetUpdate)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', scheduleBudgetUpdate)
      if (budgetRaf !== null) cancelAnimationFrame(budgetRaf)
    }
  }, [updateComposerHeightBudget, inputContainerRef, contentWrapRef, attachmentSectionRef, toolbarRef, footerRef])

  return { composerMaxHeight, inputContainerMaxHeight, textareaMaxHeight }
}

/**
 * textarea 高度自适应（跟随内容，受 textareaMaxHeight 限制）。
 */
export function useTextareaAutosize({
  textareaRef,
  text,
  textareaMaxHeight,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  text: string
  textareaMaxHeight: number
}) {
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // 只有真正空字符串时才重置高度；保留仅空格/空行时的换行高度
    if (text.length === 0) {
      textarea.style.height = `${TEXTAREA_MIN_HEIGHT}px`
      return
    }

    textarea.style.height = 'auto'
    const scrollHeight = textarea.scrollHeight
    textarea.style.height = Math.max(TEXTAREA_MIN_HEIGHT, Math.min(scrollHeight, textareaMaxHeight)) + 'px'
  }, [text, textareaMaxHeight, textareaRef])
}
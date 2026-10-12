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
import type { DragDropEvent } from '@tauri-apps/api/webview'
import { isTauri, getDesktopPlatform } from '../../utils/tauri'
import {
  getInternalDragSnapshot,
  isPointInsideElement,
  subscribeInternalDrag,
  subscribeInternalDrop,
} from '../../lib/internalDragCore'
import type { DraggedFileInfo } from './InputBox.types'

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

// ============================================
// External (Tauri) file-drop listeners
// --
// 两条平台互斥的监听：非 macOS 走标准 onDragDropEvent，macOS 走 Rust 端
// 转发的 file-drop-* 事件。仅订阅，不做状态，回调由 InputBox 注入。
// ============================================

export function useTauriDropListeners(handleTauriDragDropEvent: (event: DragDropEvent) => void) {
  // 非 macOS：Tauri 标准 onDragDropEvent API
  useEffect(() => {
    if (!isTauri() || getDesktopPlatform() === 'macos') return

    let disposed = false
    let unlisten: (() => void) | null = null

    void import('@tauri-apps/api/webview')
      .then(async ({ getCurrentWebview }) => {
        const cleanup = await getCurrentWebview().onDragDropEvent(event => {
          handleTauriDragDropEvent(event.payload)
        })

        if (disposed) {
          cleanup()
        } else {
          unlisten = cleanup
        }
      })
      .catch(err => {
        console.warn('[InputBox] Failed to listen for Tauri drag-drop events:', err)
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [handleTauriDragDropEvent])

  // macOS：Rust 端 WindowEvent::DragDrop 转发的 file-drop-* 事件
  useEffect(() => {
    if (!isTauri() || getDesktopPlatform() !== 'macos') return

    let disposed = false
    const cleanupFns: (() => void)[] = []

    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      if (disposed) return

      const { PhysicalPosition } = await import('@tauri-apps/api/dpi')

      const onEnter = await listen<[string[], number, number]>('file-drop-enter', e => {
        if (disposed) return
        handleTauriDragDropEvent({
          type: 'enter',
          paths: e.payload[0],
          position: new PhysicalPosition(e.payload[1], e.payload[2]),
        })
      })
      cleanupFns.push(onEnter)

      const onOver = await listen<[number, number]>('file-drop-over', e => {
        if (disposed) return
        handleTauriDragDropEvent({ type: 'over', position: new PhysicalPosition(e.payload[0], e.payload[1]) })
      })
      cleanupFns.push(onOver)

      const onDrop = await listen<[string[], number, number]>('file-drop-drop', e => {
        if (disposed) return
        handleTauriDragDropEvent({
          type: 'drop',
          paths: e.payload[0],
          position: new PhysicalPosition(e.payload[1], e.payload[2]),
        })
      })
      cleanupFns.push(onDrop)

      const onLeave = await listen<void>('file-drop-leave', () => {
        if (disposed) return
        handleTauriDragDropEvent({ type: 'leave' })
      })
      cleanupFns.push(onLeave)
    })

    return () => {
      disposed = true
      cleanupFns.forEach(fn => fn())
    }
  }, [handleTauriDragDropEvent])
}

// ============================================
// Internal file-mention drag indicator
// --
// 内部拖拽（sidebar 文件 → 输入框）状态与落点订阅；返回是否处于拖入态。
// ============================================

export function useInternalFileDrop({
  inputContainerRef,
  onDropFile,
}: {
  inputContainerRef: RefObject<HTMLDivElement | null>
  onDropFile: (file: DraggedFileInfo) => void
}) {
  const [isInternalFileDragging, setIsInternalFileDragging] = useState(false)

  useEffect(() => {
    const updateInternalFileDragState = () => {
      const active = getInternalDragSnapshot().active
      if (!active || active.payload.kind !== 'file-mention') {
        setIsInternalFileDragging(false)
        return
      }
      setIsInternalFileDragging(isPointInsideElement(active.current, inputContainerRef.current))
    }

    updateInternalFileDragState()
    return subscribeInternalDrag(updateInternalFileDragState)
  }, [inputContainerRef])

  useEffect(() => {
    return subscribeInternalDrop(event => {
      if (event.payload.kind !== 'file-mention') return
      if (!isPointInsideElement(event.point, inputContainerRef.current)) return
      onDropFile(event.payload.file)
    })
  }, [inputContainerRef, onDropFile])

  return isInternalFileDragging
}
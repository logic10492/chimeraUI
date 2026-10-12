/**
 * DiffViewerUnifiedView - Unified（单列）diff 渲染容器。
 *
 * 拆自 DiffViewer.tsx（批次 ④）。包含：
 * - UnifiedDiffView：虚拟滚动单列架构
 * - WrappedUnifiedDiffView：自动换行 + 动态高度虚拟滚动
 *
 * 两者由 DiffViewerContent 按 viewMode/wordWrap 选择；显式 props 接收数据，
 * 无父级闭包依赖。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HighlightTokens } from '../hooks/useSyntaxHighlight'
import { useDynamicVirtualScroll } from '../hooks/useDynamicVirtualScroll'
import type { DiffStyle } from '../store/themeStore'
import { useDiffContainerHeight, useDiffExpansion } from './DiffViewer.hooks'
import {
  OVERSCAN,
  alignDeleteChangeBars,
  collapseContextUnified,
  estimateWrappedVisualLineCount,
  getChangeBarProps,
  getGutterBgClass,
  getLineBgClass,
  getSeparatorDirections,
  isCollapsed,
} from './DiffViewer.utils'
import type { UnifiedLine } from './DiffViewer.types'
import { LineNumberCell } from './DiffViewerLineNumberCell'
import { DiffMarkerCell } from './DiffViewerDiffMarkerCell'
import { CollapsedExpandButton } from './DiffViewerCollapsedExpandButton'
import { CollapsedLabelOverlay } from './DiffViewerCollapsedLabelOverlay'
import { CollapsedContinuation } from './DiffViewerCollapsedContinuation'
import { CollapsedBar } from './DiffViewerCollapsedBar'
import { LineContent } from './DiffViewerLineContent'

// ============================================
// Unified Diff View — 和 SplitDiffView / CodePreview 一致的架构
//
// 结构:
//   外层容器 (overflow-y: auto, overflow-x: hidden) — 垂直滚动唯一来源
//     高度占位 (height: totalHeight, relative) — 虚拟滚动
//       absolute div (translateY: offsetY) — 可见行
//         flex row
//           gutter (shrink-0, overflow: hidden):
//             markers 模式: oldLineNo | newLineNo | +/-
//             changeBars 模式: changeBar | oldLineNo | newLineNo
//           content (flex-1, overflow-x: auto, scrollbar-none): 代码
//             inline-block min-w-full — 被最宽行撑开
//     sticky proxy scrollbar (bottom: 0) — 可见的横向滚动条
// ============================================

export const UnifiedDiffView = memo(function UnifiedDiffView({
  beforeTokens,
  afterTokens,
  lines,
  lineNumberWidth,
  isResizing,
  maxHeight,
  diffStyle,
  lineHeight,
  stateKey,
}: {
  beforeTokens: HighlightTokens | null
  afterTokens: HighlightTokens | null
  lines: UnifiedLine[]
  lineNumberWidth: number
  isResizing: boolean
  maxHeight?: number
  diffStyle: DiffStyle
  lineHeight: number
  stateKey?: string
}) {
  const { t } = useTranslation(['components', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const scrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const maxScrollWidthRef = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)
  const containerHeight = useDiffContainerHeight(containerRef, isResizing)
  const [contentWidth, setContentWidth] = useState(0)
  const [contentClientWidth, setContentClientWidth] = useState(0)

  const { displayLines, handleExpand } = useDiffExpansion(stateKey, lines, collapseContextUnified)

  const totalHeight = displayLines.length * lineHeight

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / lineHeight)
    const end = Math.min(displayLines.length, start + visibleCount + OVERSCAN * 2)
    return { startIndex: start, endIndex: end, offsetY: start * lineHeight }
  }, [scrollTop, containerHeight, displayLines.length, lineHeight])


  // 测量 content 宽度 — 追踪可见行 scrollWidth 历史最大值
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const inner = content.firstElementChild as HTMLElement

    const measureNow = () => {
      if (inner) {
        const sw = inner.scrollWidth
        if (sw > maxScrollWidthRef.current) {
          maxScrollWidthRef.current = sw
          inner.style.minWidth = `${sw}px`
        }
        setContentWidth(maxScrollWidthRef.current)
      }
      setContentClientWidth(content.clientWidth)
    }

    // 虚拟行窗口变化时 MutationObserver 会连发，同帧合并为一次布局读
    let measureRaf: number | null = null
    const measure = () => {
      if (measureRaf !== null) return
      measureRaf = requestAnimationFrame(() => {
        measureRaf = null
        measureNow()
      })
    }

    measureNow()
    const ro = new ResizeObserver(() => {
      maxScrollWidthRef.current = 0
      if (inner) inner.style.minWidth = ''
      measure()
    })
    ro.observe(content)
    const mo = new MutationObserver(measure)
    mo.observe(content, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
      if (measureRaf !== null) cancelAnimationFrame(measureRaf)
    }
  }, [startIndex, endIndex])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // proxy scrollbar ↔ content 面板水平同步（带 guard 防循环）
  const handleScrollbar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (scrollSourceRef.current === 'content') return
    scrollSourceRef.current = 'scrollbar'
    if (contentRef.current) contentRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      scrollSourceRef.current = null
    })
  }, [])
  const handleContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (scrollSourceRef.current === 'scrollbar') return
    scrollSourceRef.current = 'content'
    if (scrollbarRef.current) scrollbarRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      scrollSourceRef.current = null
    })
  }, [])

  if (lines.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-400 text-[length:var(--fs-base)]">
        {t('diffViewer.noChanges')}
      </div>
    )
  }

  const useChangeBars = diffStyle === 'changeBars'
  const GUTTER_WIDTH = useChangeBars ? lineNumberWidth * 2 + 4 : lineNumberWidth * 2 + 20

  const gutterRows: React.ReactNode[] = []
  const contentRows: React.ReactNode[] = []

  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      const directions = getSeparatorDirections(item)
      gutterRows.push(
        <div
          key={i}
          data-separator="line-info"
          data-expand-index=""
          className="diff-separator-surface relative overflow-visible"
          style={{ height: lineHeight }}
        >
          <CollapsedExpandButton
            directions={directions}
            onExpand={direction => handleExpand(item.id, direction)}
            width={lineNumberWidth * 2}
          />
          <CollapsedLabelOverlay
            count={item.count}
            t={t}
            onExpand={direction => handleExpand(item.id, direction)}
            height={lineHeight}
            left={lineNumberWidth * 2}
          />
        </div>,
      )
      contentRows.push(
        <div key={i} data-separator="line-info" data-expand-index="" className="diff-separator-surface" style={{ height: lineHeight }}>
          <CollapsedContinuation height={lineHeight} />
        </div>,
      )
      continue
    }

    const line = item as UnifiedLine
    let tokens: HighlightTokens | null = null
    let lineNo: number | undefined
    if (line.type === 'delete' && line.oldLineNo) {
      tokens = beforeTokens
      lineNo = line.oldLineNo
    } else if ((line.type === 'add' || line.type === 'context') && line.newLineNo) {
      tokens = afterTokens
      lineNo = line.newLineNo
    }

    // Gutter 行
    gutterRows.push(
      useChangeBars ? (
        <div key={i} className={`flex items-stretch ${getGutterBgClass(line.type)}`} style={{ height: lineHeight }}>
          <div {...getChangeBarProps(line.type, i * lineHeight)} />
          <LineNumberCell lineNo={line.oldLineNo} width={lineNumberWidth} type={line.type} />
          <LineNumberCell lineNo={line.newLineNo} width={lineNumberWidth} type={line.type} />
        </div>
      ) : (
        <div key={i} className={`flex ${getGutterBgClass(line.type)}`} style={{ height: lineHeight }}>
          <LineNumberCell lineNo={line.oldLineNo} width={lineNumberWidth} type={line.type} />
          <LineNumberCell lineNo={line.newLineNo} width={lineNumberWidth} type={line.type} />
          <DiffMarkerCell type={line.type} />
        </div>
      ),
    )

    // Content 行
    contentRows.push(
      <div
        key={i}
        className={`pr-2 pl-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] whitespace-pre ${getLineBgClass(line.type)}`}
        style={{ height: lineHeight }}
      >
        <LineContent line={{ ...line, lineNo }} tokens={tokens} />
      </div>,
    )
  }

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden custom-scrollbar font-mono text-[length:var(--fs-code)] h-full"
      style={maxHeight !== undefined ? { maxHeight } : undefined}
      onScroll={handleScroll}
    >
      {/* 虚拟滚动高度占位 */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0 flex" style={{ transform: `translateY(${offsetY}px)` }}>
          {/* Gutter: 固定宽度，不水平滚动 */}
          <div className="shrink-0 overflow-visible" style={{ width: GUTTER_WIDTH }}>
            {gutterRows}
          </div>

          {/* Content: 独立水平滚动，隐藏自身滚动条 */}
          <div
            ref={contentRef}
            className="flex-1 min-w-0 overflow-x-auto scrollbar-none"
            onScroll={handleContentScroll}
          >
            <div className="inline-block min-w-full">{contentRows}</div>
          </div>
        </div>
      </div>

      {/* Sticky proxy 横向滚动条 — 只在内容实际溢出时显示 */}
      {contentWidth > contentClientWidth && (
        <div className="sticky bottom-0 z-10 flex">
          <div className="shrink-0" style={{ width: GUTTER_WIDTH }} />
          <div ref={scrollbarRef} className="flex-1 min-w-0 overflow-x-auto code-scrollbar" onScroll={handleScrollbar}>
            <div style={{ width: contentWidth, height: 1 }} />
          </div>
        </div>
      )}
    </div>
  )
})

export const WrappedUnifiedDiffView = memo(function WrappedUnifiedDiffView({
  beforeTokens,
  afterTokens,
  lines,
  lineNumberWidth,
  isResizing,
  maxHeight,
  diffStyle,
  lineHeight,
  stateKey,
}: {
  beforeTokens: HighlightTokens | null
  afterTokens: HighlightTokens | null
  lines: UnifiedLine[]
  lineNumberWidth: number
  isResizing: boolean
  maxHeight?: number
  diffStyle: DiffStyle
  lineHeight: number
  stateKey?: string
}) {
  const { t } = useTranslation(['components', 'common'])
  const { displayLines, handleExpand } = useDiffExpansion(stateKey, lines, collapseContextUnified)

  const useChangeBars = diffStyle === 'changeBars'
  const gutterWidth = useChangeBars ? lineNumberWidth * 2 + 4 : lineNumberWidth * 2 + 20
  const estimateRowHeight = useCallback(
    (index: number, containerWidth: number) => {
      const item = displayLines[index]
      if (!item || isCollapsed(item)) return lineHeight

      const availableWidth = Math.max(0, containerWidth - gutterWidth - 16)
      return estimateWrappedVisualLineCount((item as UnifiedLine).content, availableWidth) * lineHeight
    },
    [displayLines, gutterWidth, lineHeight],
  )

  const { containerRef, totalHeight, startIndex, endIndex, offsetY, handleScroll, measureRef } =
    useDynamicVirtualScroll({
      lineCount: displayLines.length,
      isResizing,
      estimateLineHeight: lineHeight,
      estimateHeight: estimateRowHeight,
    })

  const measureWrappedUnifiedRowRef = useCallback(
    (index: number, el: HTMLDivElement | null) => {
      measureRef(index, el)
      if (!el) return

      alignDeleteChangeBars(el, offsetY + el.offsetTop)
    },
    [measureRef, offsetY],
  )

  if (lines.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-400 text-[length:var(--fs-base)]">
        {t('diffViewer.noChanges')}
      </div>
    )
  }

  const visibleRows: React.ReactNode[] = []
  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      visibleRows.push(
        <div key={`c-${i}`} ref={el => measureWrappedUnifiedRowRef(i, el)}>
          <CollapsedBar
            count={item.count}
            t={t}
            isFirst={item.isFirst}
            isLast={item.isLast}
            chunked={item.chunked}
            onExpand={direction => handleExpand(item.id, direction)}
            lineNumberAreaWidth={lineNumberWidth * 2}
            height={lineHeight}
          />
        </div>,
      )
      continue
    }

    const line = item as UnifiedLine
    let tokens: HighlightTokens | null = null
    let lineNo: number | undefined

    if (line.type === 'delete' && line.oldLineNo) {
      tokens = beforeTokens
      lineNo = line.oldLineNo
    } else if ((line.type === 'add' || line.type === 'context') && line.newLineNo) {
      tokens = afterTokens
      lineNo = line.newLineNo
    }

    visibleRows.push(
      <div key={i} ref={el => measureWrappedUnifiedRowRef(i, el)} className={`flex items-stretch ${getLineBgClass(line.type)}`}>
        <div className="shrink-0" style={{ width: gutterWidth }}>
            {useChangeBars ? (
              <div className="flex items-stretch h-full">
                <div {...getChangeBarProps(line.type)} />
                <LineNumberCell lineNo={line.oldLineNo} width={lineNumberWidth} type={line.type} />
                <LineNumberCell lineNo={line.newLineNo} width={lineNumberWidth} type={line.type} />
              </div>
            ) : (
              <div className="flex h-full">
                <LineNumberCell lineNo={line.oldLineNo} width={lineNumberWidth} type={line.type} />
                <LineNumberCell lineNo={line.newLineNo} width={lineNumberWidth} type={line.type} />
                <DiffMarkerCell type={line.type} />
              </div>
            )}
        </div>

        <div
          className="min-w-0 flex-1 px-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
          style={{ minHeight: lineHeight }}
        >
          <LineContent line={{ ...line, lineNo }} tokens={tokens} />
        </div>
      </div>,
    )
  }

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden custom-scrollbar font-mono text-[length:var(--fs-code)] h-full"
      onScroll={handleScroll}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0" style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleRows}
        </div>
      </div>
    </div>
  )
})
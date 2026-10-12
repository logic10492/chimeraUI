/**
 * DiffViewerSplitView - Split（两列）diff 渲染容器。
 *
 * 拆自 DiffViewer.tsx（批次 ④）。包含：
 * - SplitDiffView：虚拟滚动两列架构
 * - WrappedSplitDiffView：自动换行 + 动态高度虚拟滚动
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
  collapseContextPaired,
  estimateWrappedVisualLineCount,
  getChangeBarProps,
  getContentBgClass,
  getEmptyBufferBackgroundStyle,
  getEmptyBufferRowStyle,
  getGutterBgClass,
  getSeparatorDirections,
  getWrappedPairContent,
  isCollapsed,
} from './DiffViewer.utils'
import type { PairedLine } from './DiffViewer.types'
import { LineNumberCell } from './DiffViewerLineNumberCell'
import { DiffMarkerCell } from './DiffViewerDiffMarkerCell'
import { EmptyContentBuffer } from './DiffViewerEmptyContentBuffer'
import { CollapsedExpandButton } from './DiffViewerCollapsedExpandButton'
import { CollapsedLabelOverlay } from './DiffViewerCollapsedLabelOverlay'
import { CollapsedContinuation } from './DiffViewerCollapsedContinuation'
import { CollapsedBar } from './DiffViewerCollapsedBar'
import { LineContent } from './DiffViewerLineContent'

export const WrappedSplitDiffView = memo(function WrappedSplitDiffView({
  beforeTokens,
  afterTokens,
  pairedLines,
  lineNumberWidth,
  isResizing,
  maxHeight,
  diffStyle,
  lineHeight,
  stateKey,
}: {
  beforeTokens: HighlightTokens | null
  afterTokens: HighlightTokens | null
  pairedLines: PairedLine[]
  lineNumberWidth: number
  isResizing: boolean
  maxHeight?: number
  diffStyle: DiffStyle
  lineHeight: number
  stateKey?: string
}) {
  const { t } = useTranslation(['components', 'common'])
  const { displayLines, handleExpand } = useDiffExpansion(stateKey, pairedLines, collapseContextPaired)

  const useChangeBars = diffStyle === 'changeBars'
  const gutterWidth = useChangeBars ? lineNumberWidth + 4 : lineNumberWidth + 20
  const estimateRowHeight = useCallback(
    (index: number, containerWidth: number) => {
      const item = displayLines[index]
      if (!item || isCollapsed(item)) return lineHeight

      const panelWidth = Math.max(0, containerWidth / 2 - gutterWidth - 16)
      return estimateWrappedVisualLineCount(getWrappedPairContent(item as PairedLine), panelWidth) * lineHeight
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

  const measureWrappedRowRef = useCallback(
    (index: number, el: HTMLDivElement | null) => {
      measureRef(index, el)
      if (!el) return

      const rowTop = offsetY + el.offsetTop
      for (const buffer of el.querySelectorAll<HTMLElement>('.diff-empty-content-buffer')) {
        buffer.style.backgroundPosition = `5px ${-rowTop}px`
      }
      alignDeleteChangeBars(el, rowTop)
    },
    [measureRef, offsetY],
  )

  if (pairedLines.length === 0) {
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
        <div key={`c-${i}`} ref={el => measureWrappedRowRef(i, el)}>
          <CollapsedBar
            count={item.count}
            t={t}
            isFirst={item.isFirst}
            isLast={item.isLast}
            chunked={item.chunked}
            onExpand={direction => handleExpand(item.id, direction)}
            lineNumberAreaWidth={lineNumberWidth}
            height={lineHeight}
          />
        </div>,
      )
      continue
    }

    const pair = item as PairedLine
    const leftEmptyStyle = pair.left.type === 'empty' ? getEmptyBufferBackgroundStyle(0) : undefined
    const rightEmptyStyle = pair.right.type === 'empty' ? getEmptyBufferBackgroundStyle(0) : undefined
    visibleRows.push(
      <div key={i} ref={el => measureWrappedRowRef(i, el)} className="flex items-stretch">
        {/* Left panel */}
        <div
          className={`flex-1 flex items-stretch min-w-0 border-r border-border-100/30 ${getContentBgClass(pair.left.type)}`}
          style={leftEmptyStyle}
        >
          <div className="shrink-0" style={{ width: gutterWidth }}>
            {useChangeBars ? (
              <div className="flex items-stretch h-full">
                <div {...getChangeBarProps(pair.left.type)} />
                <LineNumberCell lineNo={pair.left.lineNo} width={lineNumberWidth} type={pair.left.type} />
              </div>
            ) : (
              <div className="flex h-full">
                <LineNumberCell lineNo={pair.left.lineNo} width={lineNumberWidth} type={pair.left.type} />
                <DiffMarkerCell type={pair.left.type} />
              </div>
            )}
          </div>

          <div
            className="min-w-0 flex-1 px-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] text-text-100 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            style={{ minHeight: lineHeight }}
          >
            {pair.left.type !== 'empty' && <LineContent line={pair.left} tokens={beforeTokens} />}
          </div>
        </div>

        {/* Right panel */}
        <div className={`flex-1 flex items-stretch min-w-0 ${getContentBgClass(pair.right.type)}`} style={rightEmptyStyle}>
          <div className="shrink-0" style={{ width: gutterWidth }}>
            {useChangeBars ? (
              <div className="flex items-stretch h-full">
                <div {...getChangeBarProps(pair.right.type)} />
                <LineNumberCell lineNo={pair.right.lineNo} width={lineNumberWidth} type={pair.right.type} />
              </div>
            ) : (
              <div className="flex h-full">
                <LineNumberCell lineNo={pair.right.lineNo} width={lineNumberWidth} type={pair.right.type} />
                <DiffMarkerCell type={pair.right.type} />
              </div>
            )}
          </div>

          <div
            className="min-w-0 flex-1 px-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] text-text-100 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            style={{ minHeight: lineHeight }}
          >
            {pair.right.type !== 'empty' && <LineContent line={pair.right} tokens={afterTokens} />}
          </div>
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

// ============================================
// Split Diff View - 两列架构
//
// 结构:
//   外层容器 (overflow-y: auto) — 垂直滚动主控
//     flex 行
//       左面板 (flex-1, flex row)
//         左 gutter (shrink-0, overflow: hidden)
//         左 content (flex-1, overflow-x: auto scrollbar-none)
//       分隔线
//       右面板 (flex-1, flex row)
//         右 gutter (shrink-0, overflow: hidden)
//         右 content (flex-1, overflow-x: auto scrollbar-none)
//     sticky proxy scrollbar 底部
// ============================================

export const SplitDiffView = memo(function SplitDiffView({
  beforeTokens,
  afterTokens,
  pairedLines,
  lineNumberWidth,
  isResizing,
  maxHeight,
  diffStyle,
  lineHeight,
  stateKey,
}: {
  beforeTokens: HighlightTokens | null
  afterTokens: HighlightTokens | null
  pairedLines: PairedLine[]
  lineNumberWidth: number
  isResizing: boolean
  maxHeight?: number
  diffStyle: DiffStyle
  lineHeight: number
  stateKey?: string
}) {
  const { t } = useTranslation(['components', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const leftContentRef = useRef<HTMLDivElement>(null)
  const rightContentRef = useRef<HTMLDivElement>(null)
  const leftScrollbarRef = useRef<HTMLDivElement>(null)
  const rightScrollbarRef = useRef<HTMLDivElement>(null)
  const leftScrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const rightScrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const maxLeftScrollWidthRef = useRef(0)
  const maxRightScrollWidthRef = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)
  const containerHeight = useDiffContainerHeight(containerRef, isResizing)
  const [leftContentWidth, setLeftContentWidth] = useState(0)
  const [rightContentWidth, setRightContentWidth] = useState(0)
  const [leftClientWidth, setLeftClientWidth] = useState(0)
  const [rightClientWidth, setRightClientWidth] = useState(0)
  const [leftScrollLeft, setLeftScrollLeft] = useState(0)
  const [rightScrollLeft, setRightScrollLeft] = useState(0)

  const { displayLines, handleExpand } = useDiffExpansion(stateKey, pairedLines, collapseContextPaired)

  const totalHeight = displayLines.length * lineHeight

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / lineHeight)
    const end = Math.min(displayLines.length, start + visibleCount + OVERSCAN * 2)
    return { startIndex: start, endIndex: end, offsetY: start * lineHeight }
  }, [scrollTop, containerHeight, displayLines.length, lineHeight])


  // 测量 content 宽度 — 追踪可见行 scrollWidth 历史最大值
  useEffect(() => {
    const leftContent = leftContentRef.current
    const rightContent = rightContentRef.current
    if (!leftContent || !rightContent) return
    const leftInner = leftContent.firstElementChild as HTMLElement
    const rightInner = rightContent.firstElementChild as HTMLElement

    const measureNow = () => {
      if (leftInner) {
        const sw = leftInner.scrollWidth
        if (sw > maxLeftScrollWidthRef.current) {
          maxLeftScrollWidthRef.current = sw
          leftInner.style.minWidth = `${sw}px`
        }
        setLeftContentWidth(maxLeftScrollWidthRef.current)
      }
      if (rightInner) {
        const sw = rightInner.scrollWidth
        if (sw > maxRightScrollWidthRef.current) {
          maxRightScrollWidthRef.current = sw
          rightInner.style.minWidth = `${sw}px`
        }
        setRightContentWidth(maxRightScrollWidthRef.current)
      }
      setLeftClientWidth(leftContent.clientWidth)
      setRightClientWidth(rightContent.clientWidth)
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
      maxLeftScrollWidthRef.current = 0
      maxRightScrollWidthRef.current = 0
      if (leftInner) leftInner.style.minWidth = ''
      if (rightInner) rightInner.style.minWidth = ''
      measure()
    })
    ro.observe(leftContent)
    ro.observe(rightContent)
    const mo = new MutationObserver(measure)
    mo.observe(leftContent, { childList: true, subtree: true })
    mo.observe(rightContent, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
      if (measureRaf !== null) cancelAnimationFrame(measureRaf)
    }
  }, [displayLines, startIndex, endIndex])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // 同步 proxy 滚动条 <-> content 面板（带 guard 防循环）
  const handleLeftScrollbar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (leftScrollSourceRef.current === 'content') return
    leftScrollSourceRef.current = 'scrollbar'
    setLeftScrollLeft(e.currentTarget.scrollLeft)
    if (leftContentRef.current) leftContentRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      leftScrollSourceRef.current = null
    })
  }, [])
  const handleRightScrollbar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rightScrollSourceRef.current === 'content') return
    rightScrollSourceRef.current = 'scrollbar'
    setRightScrollLeft(e.currentTarget.scrollLeft)
    if (rightContentRef.current) rightContentRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      rightScrollSourceRef.current = null
    })
  }, [])
  const handleLeftContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (leftScrollSourceRef.current === 'scrollbar') return
    leftScrollSourceRef.current = 'content'
    setLeftScrollLeft(e.currentTarget.scrollLeft)
    if (leftScrollbarRef.current) leftScrollbarRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      leftScrollSourceRef.current = null
    })
  }, [])
  const handleRightContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rightScrollSourceRef.current === 'scrollbar') return
    rightScrollSourceRef.current = 'content'
    setRightScrollLeft(e.currentTarget.scrollLeft)
    if (rightScrollbarRef.current) rightScrollbarRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      rightScrollSourceRef.current = null
    })
  }, [])

  if (pairedLines.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-400 text-[length:var(--fs-base)]">
        {t('diffViewer.noChanges')}
      </div>
    )
  }

  // 渲染可见行 — 分别生成 gutter 和 content
  const useChangeBars = diffStyle === 'changeBars'
  const gutterWidth = useChangeBars ? lineNumberWidth + 4 : lineNumberWidth + 20

  const leftGutterRows: React.ReactNode[] = []
  const leftContentRows: React.ReactNode[] = []
  const rightGutterRows: React.ReactNode[] = []
  const rightContentRows: React.ReactNode[] = []

  for (let i = startIndex; i < endIndex; i++) {
    const item = displayLines[i]

    if (isCollapsed(item)) {
      const directions = getSeparatorDirections(item)
      leftGutterRows.push(
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
            width={lineNumberWidth}
          />
          <CollapsedLabelOverlay
            count={item.count}
            t={t}
            onExpand={direction => handleExpand(item.id, direction)}
            height={lineHeight}
            left={lineNumberWidth}
          />
        </div>,
      )
      leftContentRows.push(
        <div
          key={i}
          data-separator="line-info"
          data-expand-index=""
          className="diff-separator-surface"
          style={{ height: lineHeight }}
        >
          <CollapsedContinuation height={lineHeight} />
        </div>,
      )
      rightGutterRows.push(
        <div
          key={i}
          data-separator="line-info"
          className="diff-separator-surface"
          style={{ height: lineHeight }}
        />,
      )
      rightContentRows.push(
        <div
          key={i}
          data-separator="line-info"
          className="diff-separator-surface"
          style={{ height: lineHeight }}
        >
          <CollapsedContinuation height={lineHeight} />
        </div>,
      )
      continue
    }

    const pair = item as PairedLine
    const leftGutterClass = pair.left.type === 'empty' ? 'diff-empty-content-buffer' : getGutterBgClass(pair.left.type)
    const rightGutterClass = pair.right.type === 'empty' ? 'diff-empty-content-buffer' : getGutterBgClass(pair.right.type)
    const rowTop = i * lineHeight
    const leftGutterStyle = getEmptyBufferRowStyle(lineHeight, rowTop)
    const rightGutterStyle = getEmptyBufferRowStyle(lineHeight, rowTop)

    // Left gutter
    leftGutterRows.push(
      useChangeBars ? (
        <div
          key={i}
          className={`flex items-stretch ${leftGutterClass}`}
          style={pair.left.type === 'empty' ? leftGutterStyle : { height: lineHeight }}
        >
          <div {...getChangeBarProps(pair.left.type, rowTop)} />
          <LineNumberCell lineNo={pair.left.lineNo} width={lineNumberWidth} type={pair.left.type} />
        </div>
      ) : (
        <div key={i} className={`flex ${leftGutterClass}`} style={pair.left.type === 'empty' ? leftGutterStyle : { height: lineHeight }}>
          <LineNumberCell lineNo={pair.left.lineNo} width={lineNumberWidth} type={pair.left.type} />
          <DiffMarkerCell type={pair.left.type} />
        </div>
      ),
    )

    // Left content: 代码
    leftContentRows.push(
      <div
        key={i}
        className={`pr-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] text-text-100 whitespace-pre ${pair.left.type === 'empty' ? '' : getContentBgClass(pair.left.type)}`}
        style={{ height: lineHeight }}
      >
        {pair.left.type === 'empty' ? <EmptyContentBuffer height={lineHeight} yOffset={rowTop} xOffset={leftScrollLeft - gutterWidth} /> : <LineContent line={pair.left} tokens={beforeTokens} />}
      </div>,
    )

    // Right gutter
    rightGutterRows.push(
      useChangeBars ? (
        <div
          key={i}
          className={`flex items-stretch ${rightGutterClass}`}
          style={pair.right.type === 'empty' ? rightGutterStyle : { height: lineHeight }}
        >
          <div {...getChangeBarProps(pair.right.type, rowTop)} />
          <LineNumberCell lineNo={pair.right.lineNo} width={lineNumberWidth} type={pair.right.type} />
        </div>
      ) : (
        <div key={i} className={`flex ${rightGutterClass}`} style={pair.right.type === 'empty' ? rightGutterStyle : { height: lineHeight }}>
          <LineNumberCell lineNo={pair.right.lineNo} width={lineNumberWidth} type={pair.right.type} />
          <DiffMarkerCell type={pair.right.type} />
        </div>
      ),
    )

    // Right content
    rightContentRows.push(
      <div
        key={i}
        className={`pr-2 leading-[var(--fs-code-line-height)] text-[length:var(--fs-code)] text-text-100 whitespace-pre ${pair.right.type === 'empty' ? '' : getContentBgClass(pair.right.type)}`}
        style={{ height: lineHeight }}
      >
        {pair.right.type === 'empty' ? <EmptyContentBuffer height={lineHeight} yOffset={rowTop} xOffset={rightScrollLeft - gutterWidth} /> : <LineContent line={pair.right} tokens={afterTokens} />}
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
          {/* 左面板 */}
          <div className="flex-1 flex min-w-0 border-r border-border-100/30">
            {/* 左 gutter */}
            <div className="shrink-0 overflow-visible" style={{ width: gutterWidth }}>
              {leftGutterRows}
            </div>
            {/* 左 content — 隐藏自身滚动条，由 proxy 控制 */}
            <div
              ref={leftContentRef}
              className="flex-1 min-w-0 overflow-x-auto scrollbar-none"
              onScroll={handleLeftContentScroll}
            >
              <div className="inline-block min-w-full">{leftContentRows}</div>
            </div>
          </div>

          {/* 右面板 */}
          <div className="flex-1 flex min-w-0">
            {/* 右 gutter */}
            <div className="shrink-0 overflow-visible" style={{ width: gutterWidth }}>
              {rightGutterRows}
            </div>
            {/* 右 content */}
            <div
              ref={rightContentRef}
              className="flex-1 min-w-0 overflow-x-auto scrollbar-none"
              onScroll={handleRightContentScroll}
            >
              <div className="inline-block min-w-full">{rightContentRows}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky proxy 横向滚动条 — 只在内容实际溢出时显示 */}
      {(leftContentWidth > leftClientWidth || rightContentWidth > rightClientWidth) && (
        <div className="sticky bottom-0 z-10 flex">
          {/* 左面板: gutter 占位 + scrollbar */}
          <div className="flex-1 flex min-w-0 border-r border-border-100/30">
            <div className="shrink-0" style={{ width: gutterWidth }} />
            <div
              ref={leftScrollbarRef}
              className="flex-1 min-w-0 overflow-x-auto code-scrollbar"
              onScroll={handleLeftScrollbar}
            >
              <div style={{ width: leftContentWidth, height: 1 }} />
            </div>
          </div>
          {/* 右面板: gutter 占位 + scrollbar */}
          <div className="flex-1 flex min-w-0">
            <div className="shrink-0" style={{ width: gutterWidth }} />
            <div
              ref={rightScrollbarRef}
              className="flex-1 min-w-0 overflow-x-auto code-scrollbar"
              onScroll={handleRightScrollbar}
            >
              <div style={{ width: rightContentWidth, height: 1 }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
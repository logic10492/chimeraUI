/**
 * DiffViewer - 核心 Diff 渲染组件
 *
 * 两列架构（和 CodePreview 一致）：
 * - Gutter 列：change bar（3px 竖条，增绿删红）+ 行号，固定不水平滚动
 * - Content 列：代码内容，独立水平滚动
 *
 * 默认使用虚拟滚动；启用自动换行后切到 wrapped 渲染
 * 不再按文件大小、行数、字符数降级高亮或 diff
 */

import { memo, useMemo, useRef, useState, useEffect, useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useSyntaxHighlight, type HighlightTokens } from '../hooks/useSyntaxHighlight'
import { useDynamicVirtualScroll } from '../hooks/useDynamicVirtualScroll'
import { themeStore } from '../store/themeStore'
import type { DiffStyle } from '../store/themeStore'
import { getLineCount, getLineNumberColumnWidth } from '../utils/lineNumberUtils'
import { useUiState } from '../utils/uiDisclosureState'
import {
  OVERSCAN,
  codeLineHeight,
  isCollapsed,
  expandRegion,
  collapseContextPaired,
  collapseContextUnified,
  getLineBgClass,
  getGutterBgClass,
  getContentBgClass,
  getEmptyBufferBackgroundStyle,
  getEmptyBufferRowStyle,
  estimateWrappedVisualLineCount,
  getWrappedPairContent,
  getChangeBarProps,
  getSeparatorDirections,
  computePairedLines,
  computeUnifiedLines,
} from './DiffViewer.utils'
import type {
  DiffViewerProps,
  DiffViewerData,
  PairedLine,
  UnifiedLine,
  ExpandDirection,
  ExpansionRegion,
} from './DiffViewer.types'
import { LineNumberCell } from './DiffViewerLineNumberCell'
import { DiffMarkerCell } from './DiffViewerDiffMarkerCell'
import { EmptyContentBuffer } from './DiffViewerEmptyContentBuffer'
import { CollapsedExpandButton } from './DiffViewerCollapsedExpandButton'
import { CollapsedLabelOverlay } from './DiffViewerCollapsedLabelOverlay'
import { CollapsedContinuation } from './DiffViewerCollapsedContinuation'
import { CollapsedBar } from './DiffViewerCollapsedBar'
import { LineContent } from './DiffViewerLineContent'

export type { ViewMode, DiffViewerProps, DiffViewerData, LineType } from './DiffViewer.types'

function useDiffLineNumberWidth(before: string, after: string): number {
  return useMemo(
    () => getLineNumberColumnWidth(Math.max(getLineCount(before), getLineCount(after))),
    [before, after],
  )
}

function alignDeleteChangeBars(container: HTMLElement, yOffset: number) {
  for (const bar of container.querySelectorAll<HTMLElement>('.diff-change-bar-delete')) {
    bar.style.backgroundPositionY = `${-yOffset}px`
  }
}

// ============================================
// Main Component
// ============================================

// eslint-disable-next-line react-refresh/only-export-components -- DiffViewer consumers share this data with fullscreen instances.
export function useDiffViewerData(before: string, after: string, language = 'text', isResizing = false, enabled = true): DiffViewerData {
  const shouldHighlight = enabled && !isResizing && language !== 'text'
  const { output: beforeTokens } = useSyntaxHighlight(before, {
    lang: language,
    mode: 'tokens',
    enabled: shouldHighlight,
  })
  const { output: afterTokens } = useSyntaxHighlight(after, {
    lang: language,
    mode: 'tokens',
    enabled: shouldHighlight,
  })
  const skipWordDiff = isResizing
  const pairedLines = useMemo(() => (enabled ? computePairedLines(before, after, skipWordDiff) : []), [before, after, enabled, skipWordDiff])
  const unifiedLines = useMemo(() => (enabled ? computeUnifiedLines(before, after) : []), [before, after, enabled])
  const lineNumberWidth = useDiffLineNumberWidth(enabled ? before : '', enabled ? after : '')

  return useMemo(
    () => ({ beforeTokens, afterTokens, pairedLines, unifiedLines, lineNumberWidth }),
    [afterTokens, beforeTokens, lineNumberWidth, pairedLines, unifiedLines],
  )
}

export const DiffViewer = memo(function DiffViewer({
  data,
  ...props
}: DiffViewerProps) {
  if (data) return <DiffViewerContent {...props} data={data} />
  return <DiffViewerWithData {...props} />
})

function DiffViewerWithData({ before, after, language = 'text', isResizing = false, ...props }: DiffViewerProps) {
  const data = useDiffViewerData(before, after, language, isResizing)
  return <DiffViewerContent before={before} after={after} language={language} isResizing={isResizing} {...props} data={data} />
}

const DiffViewerContent = memo(function DiffViewerContent({
  before,
  after,
  viewMode = 'split',
  maxHeight,
  isResizing = false,
  wordWrap,
  data,
  stateKey,
}: DiffViewerProps & { data: DiffViewerData }) {
  const { diffStyle, codeWordWrap, codeFontScale } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = wordWrap ?? codeWordWrap
  const lineHeight = codeLineHeight(codeFontScale)
  const resolvedData = data

  // 纯增加或纯删除时，split 模式另一边是空的没意义，自动降级为 unified
  const isAddOnly = !before.trim()
  const isDeleteOnly = !after.trim()
  const effectiveViewMode = isAddOnly || isDeleteOnly ? 'unified' : viewMode

  if (effectiveViewMode === 'split') {
    if (resolvedWordWrap) {
      return (
        <WrappedSplitDiffView
          beforeTokens={resolvedData.beforeTokens}
          afterTokens={resolvedData.afterTokens}
          pairedLines={resolvedData.pairedLines}
          lineNumberWidth={resolvedData.lineNumberWidth}
          isResizing={isResizing}
          maxHeight={maxHeight}
          diffStyle={diffStyle}
          lineHeight={lineHeight}
          stateKey={stateKey ? `${stateKey}:wrapped-split` : undefined}
        />
      )
    }

    return (
      <SplitDiffView
        beforeTokens={resolvedData.beforeTokens}
        afterTokens={resolvedData.afterTokens}
        pairedLines={resolvedData.pairedLines}
        lineNumberWidth={resolvedData.lineNumberWidth}
        isResizing={isResizing}
        maxHeight={maxHeight}
        diffStyle={diffStyle}
        lineHeight={lineHeight}
        stateKey={stateKey ? `${stateKey}:split` : undefined}
      />
    )
  }

  if (resolvedWordWrap) {
    return (
      <WrappedUnifiedDiffView
        beforeTokens={resolvedData.beforeTokens}
        afterTokens={resolvedData.afterTokens}
        lines={resolvedData.unifiedLines}
        lineNumberWidth={resolvedData.lineNumberWidth}
        isResizing={isResizing}
        maxHeight={maxHeight}
        diffStyle={diffStyle}
        lineHeight={lineHeight}
        stateKey={stateKey ? `${stateKey}:wrapped-unified` : undefined}
      />
    )
  }

  return (
    <UnifiedDiffView
      beforeTokens={resolvedData.beforeTokens}
      afterTokens={resolvedData.afterTokens}
      lines={resolvedData.unifiedLines}
      lineNumberWidth={resolvedData.lineNumberWidth}
      isResizing={isResizing}
      maxHeight={maxHeight}
      diffStyle={diffStyle}
      lineHeight={lineHeight}
      stateKey={stateKey ? `${stateKey}:unified` : undefined}
    />
  )
})

const WrappedSplitDiffView = memo(function WrappedSplitDiffView({
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
  const [expandedRegions, setExpandedRegions] = useUiState<Map<number, ExpansionRegion>>(stateKey, new Map())
  const displayLines = useMemo(() => collapseContextPaired(pairedLines, expandedRegions), [pairedLines, expandedRegions])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpandedRegions(prev => expandRegion(prev, id, direction))
  }, [setExpandedRegions])

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

const SplitDiffView = memo(function SplitDiffView({
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
  const [containerHeight, setContainerHeight] = useState(300)
  const [leftContentWidth, setLeftContentWidth] = useState(0)
  const [rightContentWidth, setRightContentWidth] = useState(0)
  const [leftClientWidth, setLeftClientWidth] = useState(0)
  const [rightClientWidth, setRightClientWidth] = useState(0)
  const [leftScrollLeft, setLeftScrollLeft] = useState(0)
  const [rightScrollLeft, setRightScrollLeft] = useState(0)

  const [expandedRegions, setExpandedRegions] = useUiState<Map<number, ExpansionRegion>>(stateKey, new Map())
  const displayLines = useMemo(() => collapseContextPaired(pairedLines, expandedRegions), [pairedLines, expandedRegions])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpandedRegions(prev => expandRegion(prev, id, direction))
  }, [setExpandedRegions])

  const totalHeight = displayLines.length * lineHeight

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / lineHeight)
    const end = Math.min(displayLines.length, start + visibleCount + OVERSCAN * 2)
    return { startIndex: start, endIndex: end, offsetY: start * lineHeight }
  }, [scrollTop, containerHeight, displayLines.length, lineHeight])

  // 监听容器大小
  useEffect(() => {
    const container = containerRef.current
    if (!container || isResizing) return

    setContainerHeight(container.clientHeight)
    const resizeObserver = new ResizeObserver(() => setContainerHeight(container.clientHeight))
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [isResizing])

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

const UnifiedDiffView = memo(function UnifiedDiffView({
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
  const [containerHeight, setContainerHeight] = useState(300)
  const [contentWidth, setContentWidth] = useState(0)
  const [contentClientWidth, setContentClientWidth] = useState(0)

  const [expandedRegions, setExpandedRegions] = useUiState<Map<number, ExpansionRegion>>(stateKey, new Map())
  const displayLines = useMemo(() => collapseContextUnified(lines, expandedRegions), [lines, expandedRegions])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpandedRegions(prev => expandRegion(prev, id, direction))
  }, [setExpandedRegions])

  const totalHeight = displayLines.length * lineHeight

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / lineHeight)
    const end = Math.min(displayLines.length, start + visibleCount + OVERSCAN * 2)
    return { startIndex: start, endIndex: end, offsetY: start * lineHeight }
  }, [scrollTop, containerHeight, displayLines.length, lineHeight])

  useEffect(() => {
    const container = containerRef.current
    if (!container || isResizing) return

    setContainerHeight(container.clientHeight)
    const resizeObserver = new ResizeObserver(() => setContainerHeight(container.clientHeight))
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [isResizing])

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

const WrappedUnifiedDiffView = memo(function WrappedUnifiedDiffView({
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
  const [expandedRegions, setExpandedRegions] = useUiState<Map<number, ExpansionRegion>>(stateKey, new Map())
  const displayLines = useMemo(() => collapseContextUnified(lines, expandedRegions), [lines, expandedRegions])
  const handleExpand = useCallback((id: number, direction: ExpandDirection) => {
    setExpandedRegions(prev => expandRegion(prev, id, direction))
  }, [setExpandedRegions])

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


// ============================================
// DiffViewer hooks - 数据派生 / 折叠展开 / 容器高度测量
// ============================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { useSyntaxHighlight, type HighlightTokens } from '../hooks/useSyntaxHighlight'
import { getLineCount, getLineNumberColumnWidth } from '../utils/lineNumberUtils'
import { useUiState } from '../utils/uiDisclosureState'
import { expandRegion, computePairedLines, computeUnifiedLines } from './DiffViewer.utils'
import type { DiffViewerData, ExpandDirection, ExpansionRegion } from './DiffViewer.types'

export function useDiffLineNumberWidth(before: string, after: string): number {
  return useMemo(
    () => getLineNumberColumnWidth(Math.max(getLineCount(before), getLineCount(after))),
    [before, after],
  )
}

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

/**
 * 折叠区域展开状态：把原始行序列按展开状态折叠为 displayLines，
 * 并提供 handleExpand。Split/Unified/Wrapped 四个视图共用。
 */
export function useDiffExpansion<In, Out>(
  stateKey: string | undefined,
  lines: In[],
  collapse: (lines: In[], expandedRegions: Map<number, ExpansionRegion>) => Out[],
) {
  const [expandedRegions, setExpandedRegions] = useUiState<Map<number, ExpansionRegion>>(stateKey, new Map())
  const displayLines = useMemo(() => collapse(lines, expandedRegions), [lines, expandedRegions, collapse])
  const handleExpand = useCallback(
    (id: number, direction: ExpandDirection) => {
      setExpandedRegions(prev => expandRegion(prev, id, direction))
    },
    [setExpandedRegions],
  )

  return { displayLines, handleExpand }
}

/**
 * 跟踪容器 clientHeight，isResizing 期间挂起。
 */
export function useDiffContainerHeight(containerRef: RefObject<HTMLDivElement | null>, isResizing: boolean): number {
  const [containerHeight, setContainerHeight] = useState(300)

  useEffect(() => {
    const container = containerRef.current
    if (!container || isResizing) return

    setContainerHeight(container.clientHeight)
    const resizeObserver = new ResizeObserver(() => setContainerHeight(container.clientHeight))
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [containerRef, isResizing])

  return containerHeight
}

export type { HighlightTokens }
import type { CSSProperties } from 'react'
import { diffLines, diffWordsWithSpace } from 'diff'
import type {
  ExpandDirection,
  ExpansionRegion,
  LineType,
  PairedLine,
  PairedLineOrCollapsed,
  CollapsedPairedLine,
  UnifiedLine,
  UnifiedLineOrCollapsed,
  CollapsedUnifiedLine,
  WordDiffSegment,
  WordDiffChange,
} from './DiffViewer.types'

// ============================================
// 常量
// ============================================

/** codeFontScale 偏移 → 代码行高 (px)。基准 24px，每 1px 字号偏移对应 2px 行高增量 */
export function codeLineHeight(offset: number): number {
  return 24 + offset * 2
}
export const OVERSCAN = 5

// ============================================
// Helpers
// ============================================

export function isCollapsed(
  line: PairedLineOrCollapsed | UnifiedLineOrCollapsed,
): line is CollapsedPairedLine | CollapsedUnifiedLine {
  return 'collapsed' in line && line.collapsed === true
}

export function expandRegion(prev: Map<number, ExpansionRegion>, id: number, direction: ExpandDirection): Map<number, ExpansionRegion> {
  const next = new Map(prev)
  const current = next.get(id) ?? { fromStart: 0, fromEnd: 0 }
  next.set(id, {
    fromStart: current.fromStart + (direction === 'up' || direction === 'both' ? EXPANSION_LINE_COUNT : 0),
    fromEnd: current.fromEnd + (direction === 'down' || direction === 'both' ? EXPANSION_LINE_COUNT : 0),
  })
  return next
}

/** 上下文行保留数：变更前后各保留 CONTEXT_LINES 行 */
export const CONTEXT_LINES = 3
export const EXPANSION_LINE_COUNT = 100

/** 将连续 context 行折叠，只保留变更前后各 CONTEXT_LINES 行 */
export function collapseContextPaired(lines: PairedLine[], expandedRegions?: ReadonlyMap<number, ExpansionRegion>): PairedLineOrCollapsed[] {
  if (lines.length === 0) return []

  const result: PairedLineOrCollapsed[] = []
  let contextStart = -1

  for (let i = 0; i <= lines.length; i++) {
    const isCtx = i < lines.length && lines[i].left.type === 'context' && lines[i].right.type === 'context'

    if (isCtx) {
      if (contextStart === -1) contextStart = i
    } else {
      if (contextStart !== -1) {
        const ctxLen = i - contextStart
        const minToCollapse = CONTEXT_LINES * 2 + 2
        if (ctxLen > minToCollapse) {
          const isFirst = contextStart === 0
          const isLast = i === lines.length
          const keepBefore = isFirst ? 0 : CONTEXT_LINES
          const keepAfter = isLast ? 0 : CONTEXT_LINES
          const expanded = expandedRegions?.get(contextStart) ?? { fromStart: 0, fromEnd: 0 }
          const prefixCount = Math.min(ctxLen, keepBefore + expanded.fromStart)
          const suffixStart = Math.max(prefixCount, ctxLen - keepAfter - expanded.fromEnd)

          for (let j = contextStart; j < contextStart + prefixCount; j++) result.push(lines[j])
          if (suffixStart > prefixCount) {
            const count = suffixStart - prefixCount
            result.push({
              collapsed: true,
              count,
              id: contextStart,
              isFirst,
              isLast,
              chunked: count > EXPANSION_LINE_COUNT,
            })
          }
          for (let j = contextStart + suffixStart; j < i; j++) result.push(lines[j])
        } else {
          for (let j = contextStart; j < i; j++) result.push(lines[j])
        }
        contextStart = -1
      }
      if (i < lines.length) result.push(lines[i])
    }
  }

  return result
}

export function collapseContextUnified(lines: UnifiedLine[], expandedRegions?: ReadonlyMap<number, ExpansionRegion>): UnifiedLineOrCollapsed[] {
  if (lines.length === 0) return []

  const result: UnifiedLineOrCollapsed[] = []
  let contextStart = -1

  for (let i = 0; i <= lines.length; i++) {
    const isCtx = i < lines.length && lines[i].type === 'context'

    if (isCtx) {
      if (contextStart === -1) contextStart = i
    } else {
      if (contextStart !== -1) {
        const ctxLen = i - contextStart
        const minToCollapse = CONTEXT_LINES * 2 + 2
        if (ctxLen > minToCollapse) {
          const isFirst = contextStart === 0
          const isLast = i === lines.length
          const keepBefore = isFirst ? 0 : CONTEXT_LINES
          const keepAfter = isLast ? 0 : CONTEXT_LINES
          const expanded = expandedRegions?.get(contextStart) ?? { fromStart: 0, fromEnd: 0 }
          const prefixCount = Math.min(ctxLen, keepBefore + expanded.fromStart)
          const suffixStart = Math.max(prefixCount, ctxLen - keepAfter - expanded.fromEnd)

          for (let j = contextStart; j < contextStart + prefixCount; j++) result.push(lines[j])
          if (suffixStart > prefixCount) {
            const count = suffixStart - prefixCount
            result.push({
              collapsed: true,
              count,
              id: contextStart,
              isFirst,
              isLast,
              chunked: count > EXPANSION_LINE_COUNT,
            })
          }
          for (let j = contextStart + suffixStart; j < i; j++) result.push(lines[j])
        } else {
          for (let j = contextStart; j < i; j++) result.push(lines[j])
        }
        contextStart = -1
      }
      if (i < lines.length) result.push(lines[i])
    }
  }

  return result
}

export function getLineBgClass(type: LineType): string {
  switch (type) {
    case 'add':
      return 'bg-success-bg/40'
    case 'delete':
      return 'bg-danger-bg/40'
    case 'empty':
      return 'bg-bg-100/30'
    default:
      return ''
  }
}

export function getGutterBgClass(type: LineType): string {
  switch (type) {
    case 'add':
      return 'bg-success-bg/40'
    case 'delete':
      return 'bg-danger-bg/40'
    case 'empty':
      return 'bg-bg-100/30'
    default:
      return ''
  }
}

export function getContentBgClass(type: LineType): string {
  if (type === 'empty') return 'diff-empty-content-buffer'
  return getLineBgClass(type)
}

export function getEmptyBufferBackgroundStyle(yOffset: number, xOffset = 0): CSSProperties {
  return { backgroundPosition: `${5 + xOffset}px ${-yOffset}px` }
}

export function getEmptyBufferRowStyle(height: number, yOffset = 0, xOffset = 0): CSSProperties {
  return { height, ...getEmptyBufferBackgroundStyle(yOffset, xOffset) }
}

export function estimateWrappedVisualLineCount(content: string, availableWidth: number): number {
  if (!content) return 1
  if (availableWidth <= 0) return 1

  const charWidth = 8
  const charsPerLine = Math.max(1, Math.floor(availableWidth / charWidth))
  let visualLines = 0

  for (const segment of content.split('\n')) {
    visualLines += Math.max(1, Math.ceil(segment.length / charsPerLine))
  }

  return visualLines
}

export function getWrappedPairContent(pair: PairedLine): string {
  return pair.left.content.length >= pair.right.content.length ? pair.left.content : pair.right.content
}

/** Change bar 样式 — 行号左侧的 3px 竖条，add 实心 / delete 虚线 */
export function getChangeBarProps(type: LineType, yOffset = 0): { className: string; style?: CSSProperties } {
  switch (type) {
    case 'add':
      return { className: 'w-1 shrink-0 bg-success-100' }
    case 'delete':
      return {
        className: 'diff-change-bar-delete w-1 shrink-0',
        style: { backgroundPositionY: `${-yOffset}px` },
      }
    default:
      return { className: 'w-1 shrink-0' }
  }
}

export function getSeparatorDirections({ isFirst, isLast, chunked }: { isFirst?: boolean; isLast?: boolean; chunked?: boolean }): ExpandDirection[] {
  if (!chunked) return [!isFirst && !isLast ? 'both' : isFirst ? 'down' : 'up']
  const directions: ExpandDirection[] = []
  if (!isFirst) directions.push('up')
  if (!isLast) directions.push('down')
  return directions
}

// ============================================
// Diff Computation
// ============================================

export function computePairedLines(before: string, after: string, skipWordDiff: boolean): PairedLine[] {
  const changes = diffLines(before, after)
  const result: PairedLine[] = []
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  let oldIdx = 0,
    newIdx = 0,
    i = 0

  while (i < changes.length) {
    const change = changes[i]
    const count = change.count || 0

    if (change.removed) {
      const next = changes[i + 1]
      if (next?.added) {
        const addCount = next.count || 0
        const maxCount = Math.max(count, addCount)

        for (let j = 0; j < maxCount; j++) {
          const oldLine = j < count ? beforeLines[oldIdx + j] : undefined
          const newLine = j < addCount ? afterLines[newIdx + j] : undefined

          let leftSegments: WordDiffSegment[] | undefined
          let rightSegments: WordDiffSegment[] | undefined

          if (!skipWordDiff && oldLine !== undefined && newLine !== undefined) {
            const wordDiff = computeWordDiff(oldLine, newLine)
            if (!isTooFragmented(wordDiff.changes)) {
              leftSegments = wordDiff.left
              rightSegments = wordDiff.right
            }
          }

          result.push({
            left:
              oldLine !== undefined
                ? { type: 'delete', content: oldLine, lineNo: oldIdx + j + 1, wordDiffSegments: leftSegments }
                : { type: 'empty', content: '' },
            right:
              newLine !== undefined
                ? { type: 'add', content: newLine, lineNo: newIdx + j + 1, wordDiffSegments: rightSegments }
                : { type: 'empty', content: '' },
          })
        }

        oldIdx += count
        newIdx += addCount
        i += 2
        continue
      }

      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'delete', content: beforeLines[oldIdx + j] || '', lineNo: oldIdx + j + 1 },
          right: { type: 'empty', content: '' },
        })
      }
      oldIdx += count
    } else if (change.added) {
      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'empty', content: '' },
          right: { type: 'add', content: afterLines[newIdx + j] || '', lineNo: newIdx + j + 1 },
        })
      }
      newIdx += count
    } else {
      for (let j = 0; j < count; j++) {
        result.push({
          left: { type: 'context', content: beforeLines[oldIdx + j] || '', lineNo: oldIdx + j + 1 },
          right: { type: 'context', content: afterLines[newIdx + j] || '', lineNo: newIdx + j + 1 },
        })
      }
      oldIdx += count
      newIdx += count
    }
    i++
  }

  return result
}

export function computeUnifiedLines(before: string, after: string): UnifiedLine[] {
  const changes = diffLines(before, after)
  const result: UnifiedLine[] = []
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  let oldIdx = 0,
    newIdx = 0

  for (const change of changes) {
    const count = change.count || 0

    if (change.removed) {
      for (let j = 0; j < count; j++) {
        result.push({ type: 'delete', content: beforeLines[oldIdx + j] || '', oldLineNo: oldIdx + j + 1 })
      }
      oldIdx += count
    } else if (change.added) {
      for (let j = 0; j < count; j++) {
        result.push({ type: 'add', content: afterLines[newIdx + j] || '', newLineNo: newIdx + j + 1 })
      }
      newIdx += count
    } else {
      for (let j = 0; j < count; j++) {
        result.push({
          type: 'context',
          content: afterLines[newIdx + j] || '',
          oldLineNo: oldIdx + j + 1,
          newLineNo: newIdx + j + 1,
        })
      }
      oldIdx += count
      newIdx += count
    }
  }

  return result
}

export function isTooFragmented(changes: WordDiffChange[]): boolean {
  let commonLength = 0,
    totalLength = 0
  for (const change of changes) {
    totalLength += change.value.length
    if (!change.added && !change.removed) commonLength += change.value.length
  }
  return totalLength > 10 && commonLength / totalLength < 0.4
}

export function computeWordDiff(
  oldLine: string,
  newLine: string,
): { left: WordDiffSegment[]; right: WordDiffSegment[]; changes: WordDiffChange[] } {
  const changes = diffWordsWithSpace(oldLine, newLine)

  const mergedChanges: WordDiffChange[] = []
  for (let i = 0; i < changes.length; i++) {
    const current = changes[i]
    const prev = mergedChanges[mergedChanges.length - 1]

    if (prev && !current.added && !current.removed && /^\s*$/.test(current.value)) {
      const next = changes[i + 1]
      if ((prev.removed && next?.removed) || (prev.added && next?.added)) {
        prev.value += current.value
        continue
      }
    }

    if (prev && ((prev.added && current.added) || (prev.removed && current.removed))) {
      prev.value += current.value
    } else {
      mergedChanges.push({ ...current })
    }
  }

  const left: WordDiffSegment[] = []
  const right: WordDiffSegment[] = []
  for (const change of mergedChanges) {
    if (change.removed) left.push({ text: change.value, diffType: 'delete' })
    else if (change.added) right.push({ text: change.value, diffType: 'add' })
    else {
      left.push({ text: change.value })
      right.push({ text: change.value })
    }
  }

  return { left, right, changes: mergedChanges }
}
import type { ExpandDirection } from './DiffViewer.types'
import { getSeparatorDirections } from './DiffViewer.utils'
import { CollapsedExpandButton } from './DiffViewerCollapsedExpandButton'
import { CollapsedLabel } from './DiffViewerCollapsedLabel'

export interface CollapsedBarProps {
  count: number
  t: (key: string, opts?: Record<string, unknown>) => string
  isFirst?: boolean
  isLast?: boolean
  chunked?: boolean
  onExpand?: (direction: ExpandDirection) => void
  height?: number
  lineNumberAreaWidth?: number
}

/** Wrapped 模式直接横跨整行 */
export function CollapsedBar({
  count,
  t,
  isFirst,
  isLast,
  chunked,
  onExpand,
  height = 24,
  lineNumberAreaWidth,
}: CollapsedBarProps) {
  const directions = getSeparatorDirections({ isFirst, isLast, chunked })
  return (
    <div data-separator="line-info" data-expand-index="" className="diff-separator-surface" style={{ height }}>
      <CollapsedExpandButton directions={directions} onExpand={onExpand} width={lineNumberAreaWidth} />
      <CollapsedLabel count={count} t={t} onExpand={onExpand} height={height} />
    </div>
  )
}
import type { ExpandDirection } from './DiffViewer.types'
import { CollapsedLabel } from './DiffViewerCollapsedLabel'

export interface CollapsedLabelOverlayProps {
  count: number
  t: (key: string, opts?: Record<string, unknown>) => string
  onExpand?: (direction: ExpandDirection) => void
  height: number
  left: number
}

export function CollapsedLabelOverlay({ count, t, onExpand, height, left }: CollapsedLabelOverlayProps) {
  return (
    <div className="diff-separator-label-overlay" style={{ height, left }}>
      <CollapsedLabel count={count} t={t} onExpand={onExpand} height={height} />
    </div>
  )
}
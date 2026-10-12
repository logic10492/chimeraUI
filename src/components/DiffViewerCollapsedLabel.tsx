import type { ExpandDirection } from './DiffViewer.types'
import { CollapsedExpandButton } from './DiffViewerCollapsedExpandButton'

export interface CollapsedLabelProps {
  count: number
  t: (key: string, opts?: Record<string, unknown>) => string
  leadingDirections?: ExpandDirection[]
  onExpand?: (direction: ExpandDirection) => void
  height?: number
}

/** 折叠文案区，放在 content 区域 */
export function CollapsedLabel({ count, t, leadingDirections = [], onExpand, height = 24 }: CollapsedLabelProps) {
  return (
    <div className="diff-separator-content-row" style={{ height }}>
      {leadingDirections.length > 0 && <CollapsedExpandButton directions={leadingDirections} onExpand={onExpand} />}
      <div data-separator-content="" className="diff-separator-content">
        <button type="button" data-compact="" data-unmodified-lines="" className="diff-separator-text-button" onClick={() => onExpand?.('both')}>
          {t('diffViewer.linesUnchanged', { count })}
        </button>
      </div>
    </div>
  )
}
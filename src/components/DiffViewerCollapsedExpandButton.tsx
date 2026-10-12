import type { ExpandDirection } from './DiffViewer.types'
import { ExpandIcon } from './DiffViewerExpandIcon'

export interface CollapsedExpandButtonProps {
  directions: ExpandDirection[]
  onExpand?: (direction: ExpandDirection) => void
  width?: number
}

export function CollapsedExpandButton({ directions, onExpand, width }: CollapsedExpandButtonProps) {
  const buttonWidth = width !== undefined && directions.length > 0 ? width / directions.length : undefined

  return (
    <div data-separator-wrapper="" className="diff-separator-button-group" style={width !== undefined ? { width, flexBasis: width } : undefined}>
      {directions.map(direction => (
        <button
          key={direction}
          type="button"
          data-compact=""
          data-expand-button=""
          data-expand-up={direction === 'up' ? '' : undefined}
          data-expand-down={direction === 'down' ? '' : undefined}
          data-expand-both={direction === 'both' ? '' : undefined}
          className="diff-separator-button"
          style={buttonWidth !== undefined ? { width: buttonWidth, minWidth: 0, flexBasis: buttonWidth } : undefined}
          title={direction === 'up' ? 'Expand upward' : direction === 'down' ? 'Expand downward' : 'Expand hidden lines'}
          onClick={() => onExpand?.(direction)}
        >
          <ExpandIcon type={direction} />
        </button>
      ))}
    </div>
  )
}
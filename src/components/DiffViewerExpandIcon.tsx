import type { ExpandDirection } from './DiffViewer.types'

export interface ExpandIconProps {
  type: ExpandDirection
}

/** Pierre-like 折叠按钮，放在 gutter 区域 */
export function ExpandIcon({ type }: ExpandIconProps) {
  if (type === 'both') {
    return (
      <svg aria-hidden="true" data-icon="" className="diff-separator-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.47 9.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06L8 12.94zM7.526 1.418a.75.75 0 0 1 1.004.052l4 4a.75.75 0 1 1-1.06 1.06L8 3.06 4.53 6.53a.75.75 0 1 1-1.06-1.06l4-4z" />
      </svg>
    )
  }

  return (
    <svg
      aria-hidden="true"
      data-icon=""
      className="diff-separator-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M3.47 5.47a.75.75 0 0 1 1.06 0L8 8.94l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06" />
    </svg>
  )
}
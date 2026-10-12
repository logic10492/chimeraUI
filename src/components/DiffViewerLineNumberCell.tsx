import type { LineType } from './DiffViewer.types'

export interface LineNumberCellProps {
  lineNo?: number
  width: number
  type?: LineType
}

export function LineNumberCell({ lineNo, width, type }: LineNumberCellProps) {
  const toneClass = type === 'add' || type === 'delete' ? 'text-text-300' : 'text-text-400'
  return (
    <div
      className={`shrink-0 pl-4 pr-3 text-right text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none ${toneClass}`}
      style={{ width }}
    >
      {lineNo}
    </div>
  )
}
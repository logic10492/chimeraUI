import type { LineType } from './DiffViewer.types'

export interface DiffMarkerCellProps {
  type: LineType
}

export function DiffMarkerCell({ type }: DiffMarkerCellProps) {
  return (
    <div className="w-5 shrink-0 text-center text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)] select-none">
      {type === 'add' && <span className="text-success-100">+</span>}
      {type === 'delete' && <span className="text-danger-100">−</span>}
    </div>
  )
}
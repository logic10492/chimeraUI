import { getEmptyBufferRowStyle } from './DiffViewer.utils'

export interface EmptyContentBufferProps {
  height: number
  yOffset?: number
  xOffset?: number
}

export function EmptyContentBuffer({ height, yOffset = 0, xOffset = 0 }: EmptyContentBufferProps) {
  return <div className="diff-empty-content-buffer min-w-full" style={getEmptyBufferRowStyle(height, yOffset, xOffset)} />
}
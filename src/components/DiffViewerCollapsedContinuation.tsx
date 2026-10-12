export interface CollapsedContinuationProps {
  height?: number
}

/** 右侧/续接区域，只显示同一条 separator 的延伸背景 */
export function CollapsedContinuation({ height = 24 }: CollapsedContinuationProps) {
  return <div className="diff-separator-continuation" style={{ height }} />
}
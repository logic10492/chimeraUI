import { CircularProgress } from './CircularProgress'

interface StatusIndicatorProps {
  percent: number
  connectionState: string
  size?: number
}

export function StatusIndicator({ percent, connectionState, size = 24 }: StatusIndicatorProps) {
  const clampedPercent = Math.min(Math.max(percent, 0), 100)

  const progressColor =
    clampedPercent === 0
      ? 'text-text-500'
      : clampedPercent >= 90
        ? 'text-danger-100'
        : clampedPercent >= 70
          ? 'text-warning-100'
          : 'text-accent-main-100'

  const statusColor =
    connectionState === 'connected'
      ? 'bg-success-100'
      : connectionState === 'connecting'
        ? 'bg-warning-100 animate-pulse'
        : connectionState === 'error'
          ? 'bg-danger-100'
          : 'bg-text-500'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <CircularProgress
        progress={clampedPercent / 100}
        size={size}
        strokeWidth={3}
        trackClassName="text-text-100/10"
        progressClassName={progressColor}
      />

      <div
        className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-bg-200 ${statusColor}`}
      />
    </div>
  )
}

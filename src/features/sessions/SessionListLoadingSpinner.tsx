import { SpinnerIcon } from '../../components/Icons'

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md'
}

// ============================================
// Loading Spinner
// ============================================

export function LoadingSpinner({ size = 'md' }: LoadingSpinnerProps) {
  const sizeClass = size === 'sm' ? 'w-3 h-3' : 'w-5 h-5'
  return <SpinnerIcon className={`animate-spin text-text-400 ${sizeClass}`} size={size === 'sm' ? 12 : 20} />
}
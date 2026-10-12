import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SpinnerIcon, SplitIcon } from '../../components/Icons'
import type { ForkActionButtonProps } from './MessageRenderer.types'

export const ForkActionButton = memo(function ForkActionButton({ message, onFork, forkMessageId }: ForkActionButtonProps) {
  const { t } = useTranslation('message')
  const [isForking, setIsForking] = useState(false)

  const handleFork = useCallback(async () => {
    if (!onFork || isForking) return

    setIsForking(true)

    try {
      await onFork(message, forkMessageId)
    } catch {
      // 业务错误由上层统一处理
    } finally {
      setIsForking(false)
    }
  }, [forkMessageId, isForking, message, onFork])

  if (!onFork) return null

  return (
    <button
      onClick={() => void handleFork()}
      disabled={isForking}
      className="p-1.5 rounded-md transition-colors duration-150 text-text-400 hover:text-text-200 disabled:cursor-default disabled:text-text-500"
      title={isForking ? t('forkingFromHere') : t('forkFromHere')}
      aria-label={isForking ? t('forkingFromHere') : t('forkFromHere')}
    >
      {isForking ? <SpinnerIcon className="animate-spin" /> : <SplitIcon />}
    </button>
  )
})
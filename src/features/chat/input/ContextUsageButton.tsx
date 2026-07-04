import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusIndicator } from '../../../components/StatusIndicator'
import { DropdownMenu } from '../../../components/ui'
import { ContextDetailsDialog } from '../sidebar/ContextDetailsDialog'
import { useSessionStats, useConnectionState, formatTokens, formatCost } from '../../../hooks'

interface ContextUsageButtonProps {
  inputContainerRef?: React.RefObject<HTMLElement | null>
  contextLimit?: number
}

export function ContextUsageButton({ inputContainerRef, contextLimit }: ContextUsageButtonProps) {
  const { t } = useTranslation(['chat', 'common'])
  const stats = useSessionStats(contextLimit ?? 200000)
  const connectionState = useConnectionState()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const statsColor =
    stats.contextPercent >= 90 ? 'bg-danger-100' : stats.contextPercent >= 70 ? 'bg-warning-100' : 'bg-accent-main-100'

  const percentTextColor =
    stats.contextPercent >= 90
      ? 'text-danger-100'
      : stats.contextPercent >= 70
        ? 'text-warning-100'
        : 'text-text-400'

  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const toggleMenu = useCallback(() => setMenuOpen(prev => !prev), [])
  const openDialog = useCallback(() => {
    closeMenu()
    setDialogOpen(true)
  }, [closeMenu])

  useEffect(() => {
    if (!menuOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      closeMenu()
    }

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [menuOpen, closeMenu])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        className={`
          h-8 flex items-center rounded-lg transition-all duration-300 group overflow-hidden
          ${menuOpen ? 'bg-bg-200 text-text-100' : 'text-text-300 hover:text-text-100 hover:bg-bg-200'}
        `}
        style={{ paddingLeft: 6, paddingRight: 8 }}
        title={`Context: ${formatTokens(stats.contextUsed)} tokens • ${Math.round(stats.contextPercent)}% • ${formatCost(stats.totalCost)}`}
      >
        <StatusIndicator percent={stats.contextPercent} connectionState={connectionState} size={18} />
        <span className="ml-2 flex items-center justify-between min-w-0 transition-opacity duration-300">
          <span className="text-[length:var(--fs-sm)] font-mono text-text-300 truncate">
            {formatTokens(stats.contextUsed)} / {formatTokens(stats.contextLimit)}
          </span>
          <span className={`text-[length:var(--fs-sm)] font-medium ml-2 ${percentTextColor}`}>
            {Math.round(stats.contextPercent)}%
          </span>
        </span>
      </button>

      <DropdownMenu
        triggerRef={buttonRef}
        isOpen={menuOpen}
        position="top"
        align="right"
        constrainToRef={inputContainerRef}
        className="p-0 overflow-hidden"
      >
        <div ref={menuRef} className="relative p-3 w-[260px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[length:var(--fs-sm)] font-medium text-text-200">{t('sidebar.contextUsage')}</span>
            <div className="flex items-center gap-2">
              <span className="text-[length:var(--fs-sm)] font-mono text-text-400">
                {Math.round(stats.contextPercent)}%
              </span>
              <button
                type="button"
                onClick={openDialog}
                className="
                  shrink-0 h-6 px-2
                  rounded-md border border-border-200/60
                  bg-bg-200/70 hover:bg-bg-300
                  text-[length:var(--fs-xxs)] font-medium text-text-200
                  transition-colors
                "
              >
                {t('sidebar.viewDetails')}
              </button>
            </div>
          </div>
          <div className="w-full h-1.5 bg-bg-300 rounded-full overflow-hidden relative mb-2">
            <div
              className={`absolute inset-0 ${statsColor} transition-transform duration-500 ease-out origin-left`}
              style={{ transform: `scaleX(${Math.min(100, stats.contextPercent) / 100})` }}
            />
          </div>
          <div className="flex justify-between text-[length:var(--fs-xxs)] text-text-400 font-mono">
            <span>
              {formatTokens(stats.contextUsed)} / {formatTokens(stats.contextLimit)}
            </span>
            <span>{formatCost(stats.totalCost)}</span>
          </div>
        </div>
      </DropdownMenu>

      <ContextDetailsDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        contextLimit={stats.contextLimit}
      />
    </>
  )
}

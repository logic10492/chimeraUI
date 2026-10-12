import { useCallback } from 'react'
import type { MobileExtraKeysProps } from './Terminal.types'
import { MOBILE_EXTRA_KEY_ROWS } from './Terminal.utils'

// ============================================
// Mobile Extra Keys Toolbar
// 参考 Termux / Moshi / Blink Shell 业界方案
// CTRL / ALT 为粘滞修饰键，支持同时激活，下一次按键自动附带
// ============================================

export function MobileExtraKeys({ onSend, stickyModifiers, onToggleSticky, onFocusTerminal }: MobileExtraKeysProps) {
  const toolbarGridStyle = { gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' } as const

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
  }, [])

  const handleSend = useCallback(
    (data: string) => {
      onSend(data)
      onFocusTerminal()
    },
    [onFocusTerminal, onSend],
  )

  const btnBase =
    'flex h-8 min-w-0 w-full items-center justify-center overflow-hidden whitespace-nowrap rounded-md border px-0 text-[length:var(--fs-xxs)] leading-none font-mono font-semibold tracking-[-0.02em] text-text-200 transition-[background-color,color,border-color,transform] duration-100 select-none active:scale-[0.98]'
  const btnNormal = `${btnBase} border-border-200/20 bg-bg-200/70 active:bg-bg-300/80`
  const btnActive = `${btnBase} border-accent-main-100/45 bg-accent-main-100/18 text-accent-main-100`

  return (
    <div
      className="w-full border-t border-border-200/40 bg-bg-100/95 supports-[backdrop-filter]:bg-bg-100/85 supports-[backdrop-filter]:backdrop-blur-sm"
      style={{ WebkitTextSizeAdjust: '100%', textSizeAdjust: '100%' }}
    >
      <div className="px-1 py-1">
        <div className="grid gap-0.5">
          {MOBILE_EXTRA_KEY_ROWS.map((row, rowIndex) => (
            <div key={rowIndex} className="grid w-full gap-0.5" style={toolbarGridStyle}>
              {row.map(key => {
                const isActive = key.modifier ? stickyModifiers[key.modifier] : false

                return (
                  <button
                    key={key.label}
                    type="button"
                    aria-pressed={isActive}
                    className={isActive ? btnActive : btnNormal}
                    onPointerDown={handlePointerDown}
                    onClick={() => {
                      if (key.modifier) {
                        onToggleSticky(key.modifier)
                        onFocusTerminal()
                        return
                      }
                      if (key.data) {
                        handleSend(key.data)
                      }
                    }}
                  >
                    <span className="block max-w-full overflow-hidden whitespace-nowrap text-center leading-none [text-wrap:nowrap]">
                      {key.label}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
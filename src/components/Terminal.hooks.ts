// ============================================
// Terminal hooks - sticky modifiers / 触摸滚动 / 主题与尺寸副作用
// ============================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { updatePtySession } from '../api/pty'
import type { ApiScope } from '../api/scope'
import { createStickyModifiers, getTerminalTheme, hasStickyModifier, isDarkMode, applyStickyModifiers } from './Terminal.utils'
import type { ModifierKey, StickyModifiers } from './Terminal.types'

/**
 * Sticky modifiers（移动端 CTRL/ALT 粘滞键）+ 终端数据发送。
 */
export function useTerminalStickyModifiers(transportSendRef: RefObject<((data: string) => void) | null>) {
  const [stickyModifiers, setStickyModifiers] = useState<StickyModifiers>(() => createStickyModifiers())
  const stickyModifiersRef = useRef<StickyModifiers>(createStickyModifiers())

  const clearStickyModifiers = useCallback(() => {
    const next = createStickyModifiers()
    stickyModifiersRef.current = next
    setStickyModifiers(next)
  }, [])

  const toggleStickyModifier = useCallback((modifier: ModifierKey) => {
    setStickyModifiers(prev => {
      const next = { ...prev, [modifier]: !prev[modifier] }
      stickyModifiersRef.current = next
      return next
    })
  }, [])

  const sendTerminalData = useCallback(
    (data: string) => {
      const sticky = stickyModifiersRef.current
      const outgoing = applyStickyModifiers(data, sticky)

      transportSendRef.current?.(outgoing)

      if (hasStickyModifier(sticky)) {
        clearStickyModifiers()
      }
    },
    [clearStickyModifiers, transportSendRef],
  )

  return { stickyModifiers, clearStickyModifiers, toggleStickyModifier, sendTerminalData }
}

/**
 * 移动端触摸滚动 + 惯性。返回是否处于触摸滚动状态。
 */
export function useTerminalTouchScroll({
  containerRef,
  terminalRef,
  touchCapable,
  isActive,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  terminalRef: RefObject<XTerm | null>
  touchCapable: boolean
  isActive: boolean
}) {
  const [isTouchScrolling, setIsTouchScrolling] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const terminal = terminalRef.current
    if (!container || !terminal) return
    if (!touchCapable) return

    let touchStartY = 0
    let scrollStart = 0
    let lastTouchY = 0
    let lastTouchTime = 0
    let velocity = 0
    let momentumRaf = 0

    const stopMomentum = () => {
      if (momentumRaf) {
        cancelAnimationFrame(momentumRaf)
        momentumRaf = 0
      }
    }

    const startMomentum = () => {
      const viewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null
      if (!viewport || Math.abs(velocity) < 0.5) {
        setIsTouchScrolling(false)
        return
      }

      const friction = 0.95
      const step = () => {
        velocity *= friction
        if (Math.abs(velocity) < 0.5) {
          momentumRaf = 0
          // 惯性结束后延迟淡出滚动条
          setTimeout(() => setIsTouchScrolling(false), 600)
          return
        }
        viewport.scrollTop += velocity
        momentumRaf = requestAnimationFrame(step)
      }
      momentumRaf = requestAnimationFrame(step)
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      stopMomentum()
      const y = e.touches[0].clientY
      touchStartY = y
      lastTouchY = y
      lastTouchTime = Date.now()
      velocity = 0
      const viewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null
      scrollStart = viewport?.scrollTop ?? 0
      setIsTouchScrolling(false)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const viewport = terminal.element?.querySelector('.xterm-viewport') as HTMLElement | null
      if (!viewport) return

      const y = e.touches[0].clientY
      const delta = touchStartY - y

      if (Math.abs(delta) > 6) {
        setIsTouchScrolling(true)
      }

      // 计算速度（用于惯性）
      const now = Date.now()
      const dt = now - lastTouchTime
      if (dt > 0) {
        velocity = ((lastTouchY - y) / dt) * 16 // 归一化到每帧 px
      }
      lastTouchY = y
      lastTouchTime = now

      viewport.scrollTop = scrollStart + delta
      if (touchCapable) {
        e.preventDefault()
      }
    }

    const handleTouchEnd = () => {
      startMomentum()
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd)

    return () => {
      stopMomentum()
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isActive, touchCapable])

  return { isTouchScrolling }
}

/**
 * 主题变化（data-mode）时更新 xterm 主题。
 */
export function useTerminalThemeObserver(terminalRef: RefObject<XTerm | null>) {
  useEffect(() => {
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-mode') {
          if (terminalRef.current) {
            terminalRef.current.options.theme = getTerminalTheme(isDarkMode())
          }
          break
        }
      }
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode'],
    })

    return () => observer.disconnect()
  }, [terminalRef])
}

/**
 * 处理容器/window 尺寸变化，debounce 后 fit 并上报 PTY size。
 */
export function useTerminalResize({
  containerRef,
  terminalRef,
  fitAddonRef,
  isPanelResizingRef,
  resizeTimeoutRef,
  terminalScopeRef,
  ptyId,
  isActive,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  terminalRef: RefObject<XTerm | null>
  fitAddonRef: RefObject<FitAddon | null>
  isPanelResizingRef: RefObject<boolean>
  resizeTimeoutRef: RefObject<number | null>
  terminalScopeRef: RefObject<ApiScope>
  ptyId: string
  isActive: boolean
}) {
  useEffect(() => {
    if (!isActive || !fitAddonRef.current || !terminalRef.current) return

    const handleResize = () => {
      if (isPanelResizingRef.current) return

      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = window.setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current && !isPanelResizingRef.current) {
          fitAddonRef.current.fit()
          const { cols, rows } = terminalRef.current
          updatePtySession(ptyId, { size: { cols, rows } }, terminalScopeRef.current).catch(() => {})
        }
      }, 16)
    }

    window.addEventListener('resize', handleResize)
    const resizeObserver = new ResizeObserver(handleResize)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    const handlePanelResizeStart = () => {
      isPanelResizingRef.current = true
    }
    window.addEventListener('panel-resize-start', handlePanelResizeStart)

    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('panel-resize-start', handlePanelResizeStart)
      resizeObserver.disconnect()
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
        resizeTimeoutRef.current = null
      }
    }
  }, [isActive, ptyId])
}

/**
 * tab 变为活动状态时聚焦并重新 fit。
 */
export function useTerminalActiveFocus({
  terminalRef,
  fitAddonRef,
  isActive,
}: {
  terminalRef: RefObject<XTerm | null>
  fitAddonRef: RefObject<FitAddon | null>
  isActive: boolean
}) {
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus()
      if (fitAddonRef.current) {
        requestAnimationFrame(() => {
          fitAddonRef.current?.fit()
        })
      }
    }
  }, [isActive])
}

/**
 * 监听面板 resize 结束事件，重新 fit 并上报 PTY size。
 */
export function useTerminalPanelResizeEnd({
  terminalRef,
  fitAddonRef,
  isPanelResizingRef,
  terminalScopeRef,
  ptyId,
  isActive,
}: {
  terminalRef: RefObject<XTerm | null>
  fitAddonRef: RefObject<FitAddon | null>
  isPanelResizingRef: RefObject<boolean>
  terminalScopeRef: RefObject<ApiScope>
  ptyId: string
  isActive: boolean
}) {
  useEffect(() => {
    if (!isActive) return

    const handlePanelResizeEnd = () => {
      isPanelResizingRef.current = false
      if (fitAddonRef.current && terminalRef.current) {
        requestAnimationFrame(() => {
          if (!fitAddonRef.current || !terminalRef.current) return
          fitAddonRef.current.fit()
          const { cols, rows } = terminalRef.current
          updatePtySession(ptyId, { size: { cols, rows } }, terminalScopeRef.current).catch(() => {})
        })
      }
    }

    window.addEventListener('panel-resize-end', handlePanelResizeEnd)
    return () => window.removeEventListener('panel-resize-end', handlePanelResizeEnd)
  }, [isActive, ptyId])
}
// ============================================
// Terminal - 单个 xterm 终端实例
// 使用 xterm.js + WebSocket 连接后端 PTY
// ============================================

import { useEffect, useRef, memo, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { getPtyConnectUrl, updatePtySession } from '../api/pty'
import { apiScopeKey, resolveApiScope } from '../api/scope'
import { useTheme } from '../hooks/useTheme'
import { layoutStore, useLayoutStore } from '../store/layoutStore'
import { useInputCapabilities } from '../hooks/useInputCapabilities'
import { logger } from '../utils/logger'
import { parsePtyFrame } from '../utils/ptyProtocol'
import { isTauri } from '../utils/tauri'
import { copyTextToClipboard, readTextFromClipboard } from '../utils/clipboard'
import { keybindingStore } from '../store/keybindingStore'
import type { TerminalProps } from './Terminal.types'
import { MobileExtraKeys } from './TerminalMobileExtraKeys'
import {
  TERMINAL_FONT_FALLBACK,
  getTerminalTheme,
  isDarkMode,
  isNativePasteShortcut,
} from './Terminal.utils'
import {
  useTerminalActiveFocus,
  useTerminalPanelResizeEnd,
  useTerminalResize,
  useTerminalStickyModifiers,
  useTerminalThemeObserver,
  useTerminalTouchScroll,
} from './Terminal.hooks'


function canReadClipboardText() {
  // Ctrl/Cmd+V uses ClipboardEvent.clipboardData, but smart right-click paste must actively call
  // navigator.clipboard.readText(), which browsers only expose in secure contexts.
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard?.readText
  )
}

// ============================================
// Terminal Component
// ============================================

export const Terminal = memo(function Terminal({ ptyId, apiScope, isActive }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalScopeRef = useRef(resolveApiScope(apiScope))
  const terminalScopeKeyRef = useRef(apiScopeKey(terminalScopeRef.current))
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cursorRef = useRef(0)
  const transportSendRef = useRef<((data: string) => void) | null>(null)
  const transportDisconnectRef = useRef<(() => void) | null>(null)
  const resizeTimeoutRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const isPanelResizingRef = useRef(false)
  const [hasBeenActive, setHasBeenActive] = useState(isActive)
  const { preferTouchUi, hasTouch, hasCoarsePointer } = useInputCapabilities()
  const { manualTerminalTitles } = useTheme()
  const { terminalCopyOnSelect, terminalRightClickPaste } = useLayoutStore()
  const touchCapable = hasTouch || hasCoarsePointer
  const manualTerminalTitlesRef = useRef(manualTerminalTitles)
  const terminalCopyOnSelectRef = useRef(terminalCopyOnSelect)
  const terminalRightClickPasteRef = useRef(terminalRightClickPaste)

  const { stickyModifiers, clearStickyModifiers, toggleStickyModifier, sendTerminalData } =
    useTerminalStickyModifiers(transportSendRef)

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus()
  }, [])

  useEffect(() => {
    manualTerminalTitlesRef.current = manualTerminalTitles
  }, [manualTerminalTitles])

  useEffect(() => {
    terminalCopyOnSelectRef.current = terminalCopyOnSelect
  }, [terminalCopyOnSelect])

  useEffect(() => {
    terminalRightClickPasteRef.current = terminalRightClickPaste
  }, [terminalRightClickPaste])

  // 当 tab 第一次变为活动状态时，标记它
  useEffect(() => {
    if (isActive && !hasBeenActive) {
      setHasBeenActive(true)
    }
  }, [isActive, hasBeenActive])

  // 初始化终端
  useEffect(() => {
    if (!containerRef.current) return
    if (!hasBeenActive) return

    // Read latest snapshot values from the store directly, not from
    // the render closure. This breaks the infinite cycle:
    //   old terminal cleanup → updateTerminalSnapshot → notify →
    //   re-render → effect deps changed → cleanup → notify → ...
    const freshTab = layoutStore
      .getState()
      .panelTabs.find(
        tab =>
          tab.type === 'terminal' && (tab.ptyId ?? tab.id) === ptyId && tab.scopeKey === terminalScopeKeyRef.current,
      )
    const effectBuffer = typeof freshTab?.buffer === 'string' ? freshTab.buffer : ''
    const effectScrollY = typeof freshTab?.scrollY === 'number' ? freshTab.scrollY : undefined
    const effectCursor =
      typeof freshTab?.cursor === 'number' && Number.isSafeInteger(freshTab.cursor) && freshTab.cursor >= 0
        ? freshTab.cursor
        : 0
    const effectCols =
      typeof freshTab?.cols === 'number' && Number.isSafeInteger(freshTab.cols) && freshTab.cols > 0
        ? freshTab.cols
        : undefined
    const effectRows =
      typeof freshTab?.rows === 'number' && Number.isSafeInteger(freshTab.rows) && freshTab.rows > 0
        ? freshTab.rows
        : undefined

    const restoreSize = effectBuffer && effectCols && effectRows ? { cols: effectCols, rows: effectRows } : undefined

    mountedRef.current = true
    cursorRef.current = effectCursor
    let ws: WebSocket | null = null
    let wsConnectTimeout: number | null = null
    let disposeData: { dispose: () => void } | null = null
    let disposeTitle: { dispose: () => void } | null = null
    const terminalScope = terminalScopeRef.current
    const terminalScopeKey = terminalScopeKeyRef.current

    const touchUi = preferTouchUi
    const theme = getTerminalTheme(isDarkMode())

    // 从 CSS 变量读取终端字号（跟随 fontScale 设置）
    const rootStyle = getComputedStyle(document.documentElement)
    const termFontSize = parseInt(rootStyle.getPropertyValue('--fs-terminal').trim(), 10) || 13
    const termLineHeight = parseFloat(rootStyle.getPropertyValue('--fs-terminal-line-height').trim()) || 1.2

    const terminal = new XTerm({
      theme,
      fontFamily: rootStyle.getPropertyValue('--font-mono').trim() || TERMINAL_FONT_FALLBACK,
      fontSize: touchUi ? Math.max(termFontSize, 14) : termFontSize,
      lineHeight: touchUi ? Math.max(termLineHeight, 1.3) : termLineHeight,
      ...(restoreSize ? { cols: restoreSize.cols, rows: restoreSize.rows } : {}),
      cursorBlink: true,
      cursorStyle: 'block',
      smoothScrollDuration: touchUi ? 100 : 0,
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
      allowTransparency: true, // 开启透明背景
      ...(touchUi
        ? {
            scrollSensitivity: 2,
            macOptionIsMeta: true,
            disableStdin: false,
          }
        : {}),
    })

    const fitAddon = new FitAddon()
    const serializeAddon = new SerializeAddon()
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      if (isTauri()) {
        import('@tauri-apps/plugin-opener').then(mod => mod.openUrl(uri)).catch(() => window.open(uri))
      } else {
        window.open(uri)
      }
    })

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(serializeAddon)
    terminal.loadAddon(webLinksAddon)

    terminal.open(containerRef.current)

    // WebGL 渲染器: GPU 加速，大幅提升 TUI 渲染性能
    // 若 WebGL 不可用则静默回退到内置 DOM 渲染器
    const webglAddon = new WebglAddon()
    webglAddon.onContextLoss(() => {
      webglAddon.dispose()
      logger.log('[Terminal] WebGL context lost, falling back to DOM renderer')
    })
    try {
      terminal.loadAddon(webglAddon)
    } catch {
      webglAddon.dispose()
      logger.log('[Terminal] WebGL not available, using DOM renderer')
    }

    const textarea = terminal.textarea
    const handleTextareaBlur = () => clearStickyModifiers()

    terminal.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true

      const action = keybindingStore.findMatchingAction(event, 'terminal')
      if (action === 'terminal.paste') {
        if (isNativePasteShortcut(event)) {
          return false
        }

        event.preventDefault()
        void readTextFromClipboard()
          .then(text => {
            if (!text || !mountedRef.current) return
            sendTerminalData(text)
          })
          .catch(() => {})
        return false
      }

      if (action !== 'terminal.copySelection' || !terminal.hasSelection()) return true

      const selected = terminal.getSelection()
      if (!selected) return true

      event.preventDefault()
      void copyTextToClipboard(selected).catch(() => {})
      terminal.clearSelection()
      return false
    })

    const terminalElement = terminal.element
    const handleSelectionCopy = (event: MouseEvent) => {
      if (event.button !== 0) return
      if (!terminalCopyOnSelectRef.current || !terminal.hasSelection()) return

      const selected = terminal.getSelection()
      if (!selected) return

      void copyTextToClipboard(selected)
        .then(() => terminal.clearSelection())
        .catch(() => {})
    }

    const handleContextMenuPaste = (event: MouseEvent) => {
      if (!terminalRightClickPasteRef.current) return

      if (terminal.hasSelection()) {
        event.preventDefault()
        const selected = terminal.getSelection()
        if (selected) {
          void copyTextToClipboard(selected).catch(() => {})
          terminal.clearSelection()
        }
        return
      }

      if (!canReadClipboardText()) {
        terminal.focus()
        return
      }

      event.preventDefault()
      void readTextFromClipboard()
        .then(text => {
          if (!text || !mountedRef.current) return
          sendTerminalData(text)
          terminal.focus()
        })
        .catch(() => {})
    }

    terminalElement?.addEventListener('mouseup', handleSelectionCopy)
    terminalElement?.addEventListener('contextmenu', handleContextMenuPaste)
    if (touchUi && textarea) {
      textarea.setAttribute('autocapitalize', 'none')
      textarea.setAttribute('autocomplete', 'off')
      textarea.setAttribute('autocorrect', 'off')
      textarea.setAttribute('enterkeyhint', 'send')
      textarea.setAttribute('inputmode', 'text')
      textarea.setAttribute('spellcheck', 'false')
      textarea.addEventListener('blur', handleTextareaBlur)
    }

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // 连接 WebSocket（带自动重连）
    let reconnectTimer: number | null = null
    let reconnectAttempt = 0
    const MAX_RECONNECT_DELAY = 30000 // 最大 30s
    const BASE_RECONNECT_DELAY = 1000 // 起始 1s
    let intentionalClose = false // 标记主动关闭
    const useNativePtyBridge = isTauri()

    const resetTransport = () => {
      transportSendRef.current = null
      transportDisconnectRef.current = null
    }

    const handleConnected = () => {
      logger.log(useNativePtyBridge ? '[Terminal/Tauri] Connected:' : '[Terminal] WebSocket connected:', ptyId)
      if (!mountedRef.current) return
      reconnectAttempt = 0
      layoutStore.updateTerminalTab(ptyId, { status: 'connected' }, terminalScopeKey)
      const { cols, rows } = terminal
      logger.log('[Terminal] Sending size:', cols, 'x', rows)
      updatePtySession(ptyId, { size: { cols, rows } }, terminalScope).catch(() => {})
    }

    const handleDisconnected = ({ code, reason }: { code?: number; reason?: string }) => {
      logger.log(
        useNativePtyBridge ? '[Terminal/Tauri] Disconnected:' : '[Terminal] WebSocket closed:',
        ptyId,
        code,
        reason,
      )
      resetTransport()
      if (!mountedRef.current) return
      layoutStore.updateTerminalTab(ptyId, { status: 'disconnected' }, terminalScopeKey)

      if (intentionalClose || code === 1000) {
        terminal.write('\r\n\x1b[90m[Connection closed]\x1b[0m\r\n')
        return
      }

      reconnectAttempt++
      const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempt - 1), MAX_RECONNECT_DELAY)
      terminal.write(`\r\n\x1b[90m[Disconnected, reconnecting in ${(delay / 1000).toFixed(0)}s...]\x1b[0m\r\n`)
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        if (mountedRef.current) {
          connectTransport()
        }
      }, delay)
    }

    const connectTransport = () => {
      if (!mountedRef.current) return

      fitAddon.fit()
      const cursor = cursorRef.current

      if (useNativePtyBridge) {
        logger.log(
          '[Terminal/Tauri] Connecting PTY bridge:',
          ptyId,
          reconnectAttempt > 0 ? `(reconnect #${reconnectAttempt})` : '',
        )
        void import('../api/ptyBridge')
          .then(({ connectTauriPty }) =>
            connectTauriPty({
              ptyId,
              apiScope: terminalScope,
              cursor,
              onConnected: handleConnected,
              onMessage: chunk => {
                if (!mountedRef.current) return
                const frame = parsePtyFrame(chunk)
                if (!frame) return
                if (frame.kind === 'control') {
                  cursorRef.current = frame.cursor
                  return
                }
                terminal.write(frame.data)
                cursorRef.current += frame.data.length
              },
              onDisconnected: handleDisconnected,
              onError: message => {
                logger.log('[Terminal/Tauri] PTY bridge error:', ptyId, message)
              },
            }),
          )
          .then(connection => {
            if (!connection) return
            if (!mountedRef.current) {
              connection.close()
              return
            }
            transportSendRef.current = data => connection.send(data)
            transportDisconnectRef.current = () => connection.close()
          })
          .catch(error => {
            const message = error instanceof Error ? error.message : String(error)
            logger.log('[Terminal/Tauri] Failed to initialize PTY bridge:', ptyId, message)
            handleDisconnected({ reason: message })
          })
      } else {
        void getPtyConnectUrl(ptyId, terminalScope, { cursor })
          .then(wsUrl => {
            if (!mountedRef.current) return
            logger.log(
              '[Terminal] Connecting PTY WebSocket:',
              ptyId,
              reconnectAttempt > 0 ? `(reconnect #${reconnectAttempt})` : '',
            )
            ws = new WebSocket(wsUrl)
            ws.binaryType = 'arraybuffer'
            transportSendRef.current = data => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(data)
              }
            }
            transportDisconnectRef.current = () => ws?.close()

            ws.onopen = handleConnected

            ws.onmessage = event => {
              if (!mountedRef.current) return
              const frame = parsePtyFrame(event.data as string | ArrayBuffer)
              if (!frame) return
              if (frame.kind === 'control') {
                cursorRef.current = frame.cursor
                return
              }
              terminal.write(frame.data)
              cursorRef.current += frame.data.length
            }

            ws.onclose = event => {
              handleDisconnected({ code: event.code, reason: event.reason })
            }

            ws.onerror = event => {
              logger.log('[Terminal] WebSocket error:', ptyId, event)
            }
          })
          .catch(error => {
            const message = error instanceof Error ? error.message : String(error)
            logger.log('[Terminal] Failed to mint PTY connect ticket:', ptyId, message)
            handleDisconnected({ reason: message })
          })
      }

      disposeData?.dispose()
      disposeData = terminal.onData(data => {
        sendTerminalData(data)
      })
    }

    const scheduleInitialConnect = () => {
      wsConnectTimeout = requestAnimationFrame(connectTransport) as unknown as number
    }

    if (effectBuffer) {
      terminal.write(effectBuffer, () => {
        if (!mountedRef.current) return
        if (effectScrollY !== undefined) {
          terminal.scrollToLine(effectScrollY)
        }
        scheduleInitialConnect()
      })
    } else {
      scheduleInitialConnect()
    }

    disposeTitle = terminal.onTitleChange(title => {
      if (!mountedRef.current) return
      layoutStore.updateTerminalShellTitle(ptyId, title, manualTerminalTitlesRef.current, terminalScopeKey)
    })

    return () => {
      mountedRef.current = false
      intentionalClose = true
      if (wsConnectTimeout) {
        cancelAnimationFrame(wsConnectTimeout)
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
        resizeTimeoutRef.current = null
      }

      try {
        layoutStore.updateTerminalSnapshot(
          ptyId,
          {
            buffer: serializeAddon.serialize(),
            scrollY: terminal.buffer.active.viewportY,
            cursor: cursorRef.current,
            rows: terminal.rows,
            cols: terminal.cols,
          },
          terminalScopeKey,
        )
      } catch {
        // ignore snapshot persistence failures
      }

      transportDisconnectRef.current?.()
      disposeData?.dispose()
      disposeTitle?.dispose()
      textarea?.removeEventListener('blur', handleTextareaBlur)
      terminalElement?.removeEventListener('mouseup', handleSelectionCopy)
      terminalElement?.removeEventListener('contextmenu', handleContextMenuPaste)
      resetTransport()
      // 显式 dispose addons
      fitAddon.dispose()
      serializeAddon.dispose()
      webLinksAddon.dispose()
      webglAddon.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [ptyId, hasBeenActive, clearStickyModifiers, sendTerminalData, preferTouchUi])

  const { isTouchScrolling } = useTerminalTouchScroll({ containerRef, terminalRef, touchCapable, isActive })

  // 处理大小变化
  useTerminalResize({
    containerRef,
    terminalRef,
    fitAddonRef,
    isPanelResizingRef,
    resizeTimeoutRef,
    terminalScopeRef,
    ptyId,
    isActive,
  })

  // 主题变化时更新
  useTerminalThemeObserver(terminalRef)

  // 当 tab 变为活动状态时，聚焦并重新 fit
  useTerminalActiveFocus({ terminalRef, fitAddonRef, isActive })

  useEffect(() => {
    if (!isActive) {
      clearStickyModifiers()
    }
  }, [isActive, clearStickyModifiers])

  // 监听面板 resize 结束事件
  useTerminalPanelResizeEnd({ terminalRef, fitAddonRef, isPanelResizingRef, terminalScopeRef, ptyId, isActive })

  return (
    <>
      <style>{`
        .xterm-viewport, 
        .xterm-screen, 
        .xterm-scrollable-element {
          background-color: transparent !important;
        }
        .xterm {
          padding: 0 !important;
        }
        /* 滚动条基础样式 */
        .xterm-viewport {
          scrollbar-width: thin;
          scrollbar-color: hsl(var(--border-300) / 0.25) transparent;
        }
        .xterm-viewport::-webkit-scrollbar {
          width: 6px;
          background: transparent;
        }
        .xterm-viewport::-webkit-scrollbar-track {
          background: transparent;
        }
        .xterm-viewport::-webkit-scrollbar-thumb {
          background-color: hsl(var(--border-300) / 0.25);
          border-radius: 99px;
          transition: background-color 0.2s ease;
        }
        .xterm-viewport::-webkit-scrollbar-thumb:hover {
          background-color: hsl(var(--border-300) / 0.5);
        }
        /* 移动端：空闲时滚动条淡出，滚动时显示 */
        .scrollbar-idle .xterm-viewport::-webkit-scrollbar-thumb {
          background-color: hsl(var(--border-300) / 0);
          transition: background-color 0.8s ease;
        }
        .scrollbar-active .xterm-viewport::-webkit-scrollbar-thumb {
          background-color: hsl(var(--border-300) / 0.35);
          transition: background-color 0.15s ease;
        }
      `}</style>
      <div
        className={`${preferTouchUi ? 'flex flex-col' : ''} h-full w-full`}
        style={{
          visibility: isActive ? 'visible' : 'hidden',
          position: isActive ? 'relative' : 'absolute',
          pointerEvents: isActive ? 'auto' : 'none',
          inset: isActive ? undefined : 0,
        }}
      >
        <div
          ref={containerRef}
          className={`${preferTouchUi ? 'flex-1 min-h-0' : 'h-full'} w-full bg-bg-100 ${preferTouchUi ? 'no-scrollbar' : ''} ${preferTouchUi ? (isTouchScrolling ? 'scrollbar-active' : 'scrollbar-idle') : ''}`}
          style={{
            padding: preferTouchUi ? '0' : '4px 0 0 4px',
            touchAction: touchCapable ? 'pan-y' : 'auto',
          }}
          onClick={() => {
            if (preferTouchUi && terminalRef.current) {
              focusTerminal()
            }
          }}
          onTouchEnd={e => {
            if (terminalRef.current && e.target === containerRef.current) {
              focusTerminal()
            }
          }}
        />
        {preferTouchUi && (
          <MobileExtraKeys
            stickyModifiers={stickyModifiers}
            onToggleSticky={toggleStickyModifier}
            onSend={sendTerminalData}
            onFocusTerminal={focusTerminal}
          />
        )}
      </div>
    </>
  )
})

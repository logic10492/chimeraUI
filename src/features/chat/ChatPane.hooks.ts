// ============================================
// ChatPane hooks - Full Auto 提示 / 输入框高度 / 会话拖放 / pane controller 注册
// ============================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { autoApproveStore } from '../../store/autoApproveStore'
import { paneLayoutStore } from '../../store/paneLayoutStore'
import { paneControllerStore } from '../../store/paneControllerStore'
import { getInternalDragSnapshot, subscribeInternalDrag, subscribeInternalDrop } from '../../lib/internalDragCore'
import { resolveDropZone, type DropZone, type PaneDropOverlayHandle } from './PaneDropOverlay'

// ============================================
// Full Auto Hint
// ============================================

export function useFullAutoHint(paneId: string, t: TFunction): string | null {
  const [fullAutoHint, setFullAutoHint] = useState<string | null>(null)
  const fullAutoHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return autoApproveStore.onFullAutoChange((mode, changePaneId) => {
      // 只响应全局变更（changePaneId 为 undefined）或本 pane 的变更
      if (changePaneId && changePaneId !== paneId) return
      if (fullAutoHintTimerRef.current) clearTimeout(fullAutoHintTimerRef.current)
      const label =
        mode === 'global'
          ? t('chat:hints.autoApproveAll')
          : mode === 'session'
            ? t('chat:hints.autoApproveSession')
            : t('chat:hints.autoApproveOffHint')
      setFullAutoHint(label)
      fullAutoHintTimerRef.current = setTimeout(() => setFullAutoHint(null), 2000)
    })
  }, [t, paneId])

  return fullAutoHint
}

// ============================================
// Input Box Height
// ============================================

export function useInputBoxHeight() {
  const [inputBoxHeight, setInputBoxHeight] = useState(0)
  const inputBoxWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = inputBoxWrapperRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setInputBoxHeight(entry.contentRect.height)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { inputBoxHeight, inputBoxWrapperRef }
}

// ============================================
// Session Drag & Drop
//
// IMPORTANT: zone state lives in PaneDropOverlay (imperative handle). We do
// NOT put it in ChatPane state — dragover fires every mouse move, and
// re-rendering ChatPane on each move is very expensive once several panes
// exist (ChatArea / messages / hooks). rAF also throttles DOM writes to one
// per frame for smoothness.
//
// Zone resolution has two refs on purpose:
//   - pendingZoneRef: written synchronously by every dragover (most recent)
//   - currentZoneRef: what the overlay is actually showing (written by rAF)
// drop() prefers the pending value so it never loses a last-frame move.
// ============================================

let splitSessionNavigationToken = 0

function scheduleSplitSessionNavigation(callback: () => void) {
  const token = ++splitSessionNavigationToken

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (token !== splitSessionNavigationToken) return
      splitSessionNavigationToken = 0
      callback()
    })
  })
}

function cancelPendingSplitSessionNavigation() {
  if (splitSessionNavigationToken !== 0) {
    splitSessionNavigationToken += 1
  }
}

export function useSessionDropZone({
  paneId,
  routeSessionId,
  splitPaneEnabled,
  navigatePaneToSession,
}: {
  paneId: string
  routeSessionId: string | null
  splitPaneEnabled: boolean
  navigatePaneToSession: (paneId: string, sessionId: string, directory?: string) => void
}) {
  const overlayRef = useRef<PaneDropOverlayHandle>(null)
  const paneRootRef = useRef<HTMLDivElement>(null)
  const currentZoneRef = useRef<DropZone | null>(null)
  const pendingZoneRef = useRef<DropZone | null>(null)
  const dropRafRef = useRef<number | null>(null)

  const writeZone = useCallback((zone: DropZone | null) => {
    if (currentZoneRef.current === zone) return
    currentZoneRef.current = zone
    overlayRef.current?.setZone(zone)
  }, [])

  const cancelPendingZone = useCallback(() => {
    if (dropRafRef.current !== null) {
      cancelAnimationFrame(dropRafRef.current)
      dropRafRef.current = null
    }
    pendingZoneRef.current = null
  }, [])

  const resetDropState = useCallback(() => {
    cancelPendingZone()
    writeZone(null)
  }, [cancelPendingZone, writeZone])

  useEffect(() => {
    return () => {
      if (dropRafRef.current !== null) cancelAnimationFrame(dropRafRef.current)
    }
  }, [])

  const updateSessionDropZoneAt = useCallback(
    (clientX: number, clientY: number) => {
      if (!splitPaneEnabled) return null
      const element = paneRootRef.current
      if (!element) return null
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null

      const xRel = (clientX - rect.left) / rect.width
      const yRel = (clientY - rect.top) / rect.height
      const zone = resolveDropZone({ xRel, yRel })
      pendingZoneRef.current = zone

      if (dropRafRef.current === null) {
        dropRafRef.current = requestAnimationFrame(() => {
          dropRafRef.current = null
          writeZone(pendingZoneRef.current)
        })
      }

      return zone
    },
    [splitPaneEnabled, writeZone],
  )

  const clearSessionDropZoneAt = useCallback(
    (clientX: number, clientY: number) => {
      const element = paneRootRef.current
      if (!element) return resetDropState()
      const rect = element.getBoundingClientRect()
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        resetDropState()
      }
    },
    [resetDropState],
  )

  const handleSessionDrop = useCallback(
    (payload: { sessionId: string; directory?: string }, zone: DropZone) => {
      resetDropState()
      cancelPendingSplitSessionNavigation()

      if (payload.sessionId === routeSessionId && zone === 'center') return

      if (zone === 'center') {
        navigatePaneToSession(paneId, payload.sessionId, payload.directory)
        return
      }

      const previousFocusedPaneId = paneLayoutStore.getFocusedPaneId()
      const newPaneId = paneLayoutStore.splitPaneToSide(paneId, zone, null)
      if (newPaneId) {
        if (previousFocusedPaneId && paneLayoutStore.findLeaf(previousFocusedPaneId)) {
          paneLayoutStore.focusPane(previousFocusedPaneId)
        }

        scheduleSplitSessionNavigation(() => {
          if (!paneLayoutStore.findLeaf(newPaneId)) return
          navigatePaneToSession(newPaneId, payload.sessionId, payload.directory)
        })
      }
    },
    [paneId, routeSessionId, navigatePaneToSession, resetDropState],
  )

  useEffect(() => {
    return subscribeInternalDrag(() => {
      const active = getInternalDragSnapshot().active
      if (!active || active.payload.kind !== 'session') {
        resetDropState()
        return
      }

      const zone = updateSessionDropZoneAt(active.current.x, active.current.y)
      if (!zone) clearSessionDropZoneAt(active.current.x, active.current.y)
    })
  }, [clearSessionDropZoneAt, resetDropState, updateSessionDropZoneAt])

  useEffect(() => {
    return subscribeInternalDrop(event => {
      if (event.payload.kind !== 'session') return
      const zone = updateSessionDropZoneAt(event.point.x, event.point.y)
      if (!zone) {
        resetDropState()
        return
      }

      handleSessionDrop(
        {
          sessionId: event.payload.sessionId,
          directory: event.payload.directory,
        },
        zone,
      )
    })
  }, [handleSessionDrop, resetDropState, updateSessionDropZoneAt])

  return { overlayRef, paneRootRef }
}

// ============================================
// Pane Controller registration
// ============================================

export interface PaneControllerActions {
  newSession: () => void
  archiveSession: () => void
  previousSession: () => void
  nextSession: () => void
  toggleAgent: () => void
  copyLastResponse: () => void
  cancelMessage: () => void
  openModelSelector: () => void
  toggleFullAuto: () => void
}

export function usePaneControllerRegistration({
  paneId,
  routeSessionId,
  effectiveDirectory,
  contextLimit,
  currentProviderId,
  currentModelId,
  isStreaming,
  actions,
}: {
  paneId: string
  routeSessionId: string | null
  effectiveDirectory: string | undefined
  contextLimit: number | undefined
  currentProviderId: string | undefined
  currentModelId: string | undefined
  isStreaming: boolean
  actions: PaneControllerActions
}) {
  const controllerActionsRef = useRef(actions)

  useEffect(() => {
    controllerActionsRef.current = actions
  }, [actions])

  const stableControllerActions = useMemo(
    () => ({
      newSession: () => controllerActionsRef.current.newSession(),
      archiveSession: () => controllerActionsRef.current.archiveSession(),
      previousSession: () => controllerActionsRef.current.previousSession(),
      nextSession: () => controllerActionsRef.current.nextSession(),
      toggleAgent: () => controllerActionsRef.current.toggleAgent(),
      copyLastResponse: () => controllerActionsRef.current.copyLastResponse(),
      cancelMessage: () => controllerActionsRef.current.cancelMessage(),
      openModelSelector: () => controllerActionsRef.current.openModelSelector(),
      toggleFullAuto: () => controllerActionsRef.current.toggleFullAuto(),
    }),
    [],
  )

  useEffect(() => {
    return () => {
      paneControllerStore.removeController(paneId)
    }
  }, [paneId])

  useEffect(() => {
    paneControllerStore.setController(paneId, {
      paneId,
      sessionId: routeSessionId,
      effectiveDirectory: effectiveDirectory || '',
      contextLimit,
      currentProviderId,
      currentModelId,
      newSession: stableControllerActions.newSession,
      archiveSession: stableControllerActions.archiveSession,
      previousSession: stableControllerActions.previousSession,
      nextSession: stableControllerActions.nextSession,
      toggleAgent: stableControllerActions.toggleAgent,
      copyLastResponse: stableControllerActions.copyLastResponse,
      cancelMessage: stableControllerActions.cancelMessage,
      openModelSelector: stableControllerActions.openModelSelector,
      toggleFullAuto: stableControllerActions.toggleFullAuto,
      isStreaming,
    })
  }, [
    paneId,
    routeSessionId,
    effectiveDirectory,
    contextLimit,
    currentProviderId,
    currentModelId,
    stableControllerActions,
    isStreaming,
  ])
}

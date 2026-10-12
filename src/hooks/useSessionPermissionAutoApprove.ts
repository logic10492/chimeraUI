// ============================================
// useSessionPermissionAutoApprove - Full Auto 会话级自动批准
// ============================================

import { useCallback, useEffect, useRef } from 'react'
import { autoApproveStore, type FullAutoMode } from '../store/autoApproveStore'
import type { UsePermissionHandlerResult } from './usePermissionHandler'
import type { PermissionRequest as ApiPermissionRequest } from '../types/api/permission'

export function useSessionPermissionAutoApprove({
  routeSessionId,
  effectiveDirectory,
  sessionFamily,
  fullAutoMode,
  approvePendingOnFullAuto,
  pendingPermissionRequests,
  handlePermissionReply,
  setPendingPermissionRequests,
  refreshPendingRequests,
}: {
  routeSessionId: string | null
  effectiveDirectory: string | undefined
  sessionFamily: string[]
  fullAutoMode: FullAutoMode
  approvePendingOnFullAuto: boolean
  pendingPermissionRequests: ApiPermissionRequest[]
  handlePermissionReply: UsePermissionHandlerResult['handlePermissionReply']
  setPendingPermissionRequests: UsePermissionHandlerResult['setPendingPermissionRequests']
  refreshPendingRequests: UsePermissionHandlerResult['refreshPendingRequests']
}) {
  // Prevent infinite retry loops when auto-approve API calls fail
  // but the server may have already processed the request (lost response).
  const autoRetriedIdsRef = useRef(new Set<string>())

  const replyPermissionOnceAutomatically = useCallback(
    (request: ApiPermissionRequest) => {
      if (!autoApproveStore.claimAutoReply(request.id)) return

      void handlePermissionReply(request.id, 'once', effectiveDirectory, request.sessionID).then(success => {
        if (!success) {
          autoApproveStore.releaseAutoReply(request.id)
          // Retry once on failure. handlePermissionReply already retries 3× via withRetry,
          // but the server may have processed the request and the response was lost.
          // Force effect re-run by creating a new array reference.
          if (!autoRetriedIdsRef.current.has(request.id)) {
            autoRetriedIdsRef.current.add(request.id)
            setPendingPermissionRequests(prev => [...prev])
          }
        }
      })
    },
    [effectiveDirectory, handlePermissionReply, setPendingPermissionRequests],
  )

  // Clear retry tracking on each auto-approve batch
  useEffect(() => {
    autoRetriedIdsRef.current.clear()
  }, [approvePendingOnFullAuto, fullAutoMode])

  useEffect(() => {
    if (!routeSessionId || !approvePendingOnFullAuto || fullAutoMode !== 'session') return
    void refreshPendingRequests(sessionFamily, effectiveDirectory)
  }, [approvePendingOnFullAuto, effectiveDirectory, fullAutoMode, refreshPendingRequests, routeSessionId, sessionFamily])

  useEffect(() => {
    if (!approvePendingOnFullAuto || fullAutoMode === 'off' || pendingPermissionRequests.length === 0) return

    for (const request of pendingPermissionRequests) {
      replyPermissionOnceAutomatically(request)
    }
  }, [approvePendingOnFullAuto, fullAutoMode, pendingPermissionRequests, replyPermissionOnceAutomatically])

  return replyPermissionOnceAutomatically
}
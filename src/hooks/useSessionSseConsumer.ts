// ============================================
// useSessionSseConsumer - pane 级 SSE consumer 注册与事件分发
// ============================================

import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { serverStore } from '../store/serverStore'
import { autoApproveStore } from '../store/autoApproveStore'
import { getSelectableAgents } from '../api/agent'
import {
  registerSessionConsumer,
  updateConsumerSessionId,
  type SessionResyncReason,
} from './useGlobalEvents'
import type { ChatAreaHandle } from '../features/chat/ChatArea'
import type { UsePermissionHandlerResult } from './usePermissionHandler'
import type { Agent as ApiAgent } from '../types/api/agent'
import type { PermissionRequest, QuestionRequest } from '../types/api/permission'

export function useSessionSseConsumer({
  paneId,
  routeSessionId,
  effectiveDirectory,
  sessionFamily,
  currentDirectory,
  chatAreaRef,
  replyPermissionOnceAutomatically,
  setPendingPermissionRequests,
  setPendingQuestionRequests,
  setAgents,
  loadSession,
  refreshPendingRequests,
  refetchModels,
}: {
  paneId: string
  routeSessionId: string | null
  effectiveDirectory: string | undefined
  sessionFamily: string[]
  currentDirectory: string | undefined
  chatAreaRef: RefObject<ChatAreaHandle | null>
  replyPermissionOnceAutomatically: (request: PermissionRequest) => void
  setPendingPermissionRequests: UsePermissionHandlerResult['setPendingPermissionRequests']
  setPendingQuestionRequests: UsePermissionHandlerResult['setPendingQuestionRequests']
  setAgents: (agents: ApiAgent[]) => void
  loadSession: (sessionId: string, options?: { force?: boolean }) => Promise<void>
  refreshPendingRequests: UsePermissionHandlerResult['refreshPendingRequests']
  refetchModels: () => Promise<void>
}) {
  // ============================================
  // SSE 事件回调（permission / question / scroll / idle / error / reconnect）
  // 每个 pane 都注册自己的 consumer，由 App 顶层统一建立 SSE 连接
  // ============================================
  const sseCallbacks = useMemo(
    () => ({
      onPermissionAsked: (request: PermissionRequest) => {
        // Full Auto 会话级：当前 session 的 handler 天然只处理当前 session 的请求
        const effectiveFullAutoMode = autoApproveStore.getPaneFullAutoMode(paneId)
        if (effectiveFullAutoMode === 'session') {
          replyPermissionOnceAutomatically(request)
          return
        }

        // 自动批准检查（实验性功能）
        if (
          autoApproveStore.enabled &&
          autoApproveStore.shouldAutoApprove(request.sessionID, request.permission, request.patterns)
        ) {
          // 匹配规则，自动用 once 批准，不弹框
          replyPermissionOnceAutomatically(request)
          return
        }

        setPendingPermissionRequests(prev => {
          if (prev.some(r => r.id === request.id)) return prev
          return [...prev, request]
        })
      },
      onPermissionReplied: (data: { sessionID: string; requestID: string }) => {
        setPendingPermissionRequests(prev =>
          prev.some(r => r.id === data.requestID) ? prev.filter(r => r.id !== data.requestID) : prev,
        )
      },
      onQuestionAsked: (request: QuestionRequest) => {
        setPendingQuestionRequests(prev => {
          if (prev.some(r => r.id === request.id)) return prev
          return [...prev, request]
        })
      },
      onQuestionReplied: (data: { sessionID: string; requestID: string }) => {
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== data.requestID))
      },
      onQuestionRejected: (data: { sessionID: string; requestID: string }) => {
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== data.requestID))
      },
      onScrollRequest: () => {
        chatAreaRef.current?.scrollToBottomIfAtBottom()
      },
      onReconnected: (_reason: SessionResyncReason, serverID: string) => {
        if (serverID !== serverStore.getActiveServerId()) return

        if (routeSessionId) {
          loadSession(routeSessionId, { force: true })
          refreshPendingRequests(sessionFamily, effectiveDirectory)
        }
        refetchModels().catch(() => {})
        getSelectableAgents(currentDirectory)
          .then(setAgents)
          .catch(() => {})
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and stable functions
    [
      paneId,
      effectiveDirectory,
      routeSessionId,
      sessionFamily,
      currentDirectory,
      replyPermissionOnceAutomatically,
      setPendingPermissionRequests,
      setPendingQuestionRequests,
      setAgents,
      loadSession,
      refreshPendingRequests,
      refetchModels,
    ],
  )

  // 保存 callbacks ref 供 consumer 注册使用（避免频繁重新注册）
  const sseCallbacksRef = useRef(sseCallbacks)
  useEffect(() => {
    sseCallbacksRef.current = sseCallbacks
  }, [sseCallbacks])

  // 注册 pane 级 consumer，SSE 事件按 sessionId 分发到此
  useEffect(() => {
    const unregister = registerSessionConsumer(paneId, routeSessionId, {
      onPermissionAsked: req => sseCallbacksRef.current.onPermissionAsked(req),
      onPermissionReplied: data => sseCallbacksRef.current.onPermissionReplied(data),
      onQuestionAsked: req => sseCallbacksRef.current.onQuestionAsked(req),
      onQuestionReplied: data => sseCallbacksRef.current.onQuestionReplied(data),
      onQuestionRejected: data => sseCallbacksRef.current.onQuestionRejected(data),
      onScrollRequest: () => sseCallbacksRef.current.onScrollRequest(),
      onReconnected: (reason, serverID) => sseCallbacksRef.current.onReconnected(reason, serverID),
    })

    return unregister
  }, [paneId, routeSessionId])

  // sessionId 变化时更新 consumer 关注的 session（无需重新注册）
  useEffect(() => {
    updateConsumerSessionId(paneId, routeSessionId)
  }, [paneId, routeSessionId])
}
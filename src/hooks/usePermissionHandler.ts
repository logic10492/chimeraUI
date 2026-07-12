// ============================================
// usePermissionHandler - Permission & Question 处理 (Enhanced)
// ============================================

import { useState, useCallback, useRef } from 'react'
import {
  replyPermission,
  replyQuestion,
  rejectQuestion,
  getPendingPermissions,
  getPendingQuestions,
  type ApiPermissionRequest,
  type ApiQuestionRequest,
  type PermissionReply,
  type QuestionAnswer,
} from '../api'
import { activeSessionStore } from '../store'
import { permissionErrorHandler } from '../utils'

export interface UsePermissionHandlerResult {
  // State
  pendingPermissionRequests: ApiPermissionRequest[]
  pendingQuestionRequests: ApiQuestionRequest[]
  // Setters (for SSE events)
  setPendingPermissionRequests: React.Dispatch<React.SetStateAction<ApiPermissionRequest[]>>
  setPendingQuestionRequests: React.Dispatch<React.SetStateAction<ApiQuestionRequest[]>>
  // Handlers
  handlePermissionReply: (
    requestId: string,
    reply: PermissionReply,
    directory?: string,
    sessionId?: string,
  ) => Promise<boolean>
  handleQuestionReply: (requestId: string, answers: QuestionAnswer[], directory?: string) => Promise<boolean>
  handleQuestionReject: (requestId: string, directory?: string) => Promise<boolean>
  // Refresh (fallback sync for pending requests) - 支持单个或多个 session IDs
  refreshPendingRequests: (sessionIds?: string | string[], directory?: string) => Promise<void>
  // Reset
  resetPendingRequests: () => void
  // Loading state
  isReplying: boolean
}

const MAX_RETRIES = 3
const RETRY_DELAY = 500

async function isPermissionStillPending(
  requestId: string,
  directory?: string,
  sessionId?: string,
): Promise<boolean | undefined> {
  try {
    const pending = await getPendingPermissions(sessionId, directory)
    return pending.some(request => request.id === requestId)
  } catch {
    return undefined
  }
}

async function getQuestionPendingState(
  requestId: string,
  directory?: string,
): Promise<ApiQuestionRequest | null | undefined> {
  try {
    const pending = await getPendingQuestions(undefined, directory)
    return pending.find(request => request.id === requestId) ?? null
  } catch {
    return undefined
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES, delay = RETRY_DELAY): Promise<T> {
  let lastError: Error | undefined

  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(`[Permission] Attempt ${i + 1} failed:`, lastError.message)

      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)))
      }
    }
  }

  throw lastError
}

export function usePermissionHandler(): UsePermissionHandlerResult {
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<ApiPermissionRequest[]>([])
  const [pendingQuestionRequests, setPendingQuestionRequests] = useState<ApiQuestionRequest[]>([])
  const [isReplying, setIsReplying] = useState(false)

  // 防止重复回复
  const replyingIdsRef = useRef<Set<string>>(new Set())
  const scopeGenerationRef = useRef(0)
  const refreshGenerationRef = useRef(0)

  const handlePermissionReply = useCallback(
    async (requestId: string, reply: PermissionReply, directory?: string, sessionId?: string): Promise<boolean> => {
      if (replyingIdsRef.current.has(requestId)) {
        console.warn(`[Permission] Already replying to ${requestId}`)
        return false
      }

      const scopeGeneration = scopeGenerationRef.current
      replyingIdsRef.current.add(requestId)
      setIsReplying(true)

      try {
        await withRetry(() => replyPermission(requestId, reply, undefined, directory, sessionId))
        if (scopeGeneration !== scopeGenerationRef.current) return true
        setPendingPermissionRequests(prev =>
          prev.some(r => r.id === requestId) ? prev.filter(r => r.id !== requestId) : prev,
        )
        activeSessionStore.resolvePendingRequest(requestId)
        return true
      } catch (error) {
        const stillPending = await isPermissionStillPending(requestId, directory, sessionId)
        if (scopeGeneration !== scopeGenerationRef.current) return false
        if (stillPending === false) {
          setPendingPermissionRequests(prev =>
            prev.some(r => r.id === requestId) ? prev.filter(r => r.id !== requestId) : prev,
          )
          activeSessionStore.resolvePendingRequest(requestId)
          return true
        }

        permissionErrorHandler('reply after retries', error)
        return false
      } finally {
        if (scopeGeneration === scopeGenerationRef.current) {
          replyingIdsRef.current.delete(requestId)
          setIsReplying(replyingIdsRef.current.size > 0)
        }
      }
    },
    [],
  )

  const handleQuestionReply = useCallback(
    async (requestId: string, answers: QuestionAnswer[], directory?: string): Promise<boolean> => {
      if (replyingIdsRef.current.has(requestId)) {
        console.warn(`[Question] Already replying to ${requestId}`)
        return false
      }

      const scopeGeneration = scopeGenerationRef.current
      replyingIdsRef.current.add(requestId)
      setIsReplying(true)

      try {
        await withRetry(() => replyQuestion(requestId, answers, directory))
        if (scopeGeneration !== scopeGenerationRef.current) return true
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
        activeSessionStore.resolvePendingRequest(requestId)
        return true
      } catch (error) {
        const pendingRequest = await getQuestionPendingState(requestId, directory)
        if (scopeGeneration !== scopeGenerationRef.current) return false
        if (pendingRequest === null) {
          setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
          activeSessionStore.resolvePendingRequest(requestId)
          return true
        }
        if (pendingRequest) {
          setPendingQuestionRequests(prev =>
            prev.some(r => r.id === requestId)
              ? prev.map(r => (r.id === requestId ? pendingRequest : r))
              : [...prev, pendingRequest],
          )
        }
        permissionErrorHandler('question reply after retries', error)
        return false
      } finally {
        if (scopeGeneration === scopeGenerationRef.current) {
          replyingIdsRef.current.delete(requestId)
          setIsReplying(replyingIdsRef.current.size > 0)
        }
      }
    },
    [],
  )

  const handleQuestionReject = useCallback(async (requestId: string, directory?: string): Promise<boolean> => {
    if (replyingIdsRef.current.has(requestId)) return false

    const scopeGeneration = scopeGenerationRef.current
    replyingIdsRef.current.add(requestId)
    setIsReplying(true)

    try {
      await withRetry(() => rejectQuestion(requestId, directory))
      if (scopeGeneration !== scopeGenerationRef.current) return true
      setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
      activeSessionStore.resolvePendingRequest(requestId)
      return true
    } catch (error) {
      const pendingRequest = await getQuestionPendingState(requestId, directory)
      if (scopeGeneration !== scopeGenerationRef.current) return false
      if (pendingRequest === null) {
        setPendingQuestionRequests(prev => prev.filter(r => r.id !== requestId))
        activeSessionStore.resolvePendingRequest(requestId)
        return true
      }
      if (pendingRequest) {
        setPendingQuestionRequests(prev =>
          prev.some(r => r.id === requestId)
            ? prev.map(r => (r.id === requestId ? pendingRequest : r))
            : [...prev, pendingRequest],
        )
      }
      permissionErrorHandler('question reject after retries', error)
      return false
    } finally {
      if (scopeGeneration === scopeGenerationRef.current) {
        replyingIdsRef.current.delete(requestId)
        setIsReplying(replyingIdsRef.current.size > 0)
      }
    }
  }, [])

  // 主动轮询获取 pending 请求（用于 SSE 可能丢失事件的情况）
  // 一次拉取全量数据，用 sessionFamily 过滤后直接替换本地状态
  const refreshPendingRequests = useCallback(async (sessionIds?: string | string[], directory?: string) => {
    const scopeGeneration = scopeGenerationRef.current
    const refreshGeneration = ++refreshGenerationRef.current
    try {
      const familySet = new Set(sessionIds ? (Array.isArray(sessionIds) ? sessionIds : [sessionIds]) : [])
      const [allPermissions, allQuestions] = await Promise.all([
        getPendingPermissions(undefined, directory).catch(() => []),
        getPendingQuestions(undefined, directory).catch(() => []),
      ])
      if (scopeGeneration !== scopeGenerationRef.current || refreshGeneration !== refreshGenerationRef.current) {
        return
      }

      const nextPermissions =
        familySet.size > 0
          ? allPermissions.filter(p => familySet.has(p.sessionID) && !replyingIdsRef.current.has(p.id))
          : allPermissions.filter(p => !replyingIdsRef.current.has(p.id))

      setPendingPermissionRequests(prev => {
        const merged = new Map(nextPermissions.map(p => [p.id, p]))
        for (const request of prev) {
          if (replyingIdsRef.current.has(request.id)) continue
          if (familySet.size > 0 && !familySet.has(request.sessionID)) continue
          if (!merged.has(request.id)) merged.set(request.id, request)
        }
        return Array.from(merged.values())
      })
      setPendingQuestionRequests(
        familySet.size > 0
          ? allQuestions.filter(q => familySet.has(q.sessionID) && !replyingIdsRef.current.has(q.id))
          : allQuestions.filter(q => !replyingIdsRef.current.has(q.id)),
      )
    } catch (error) {
      if (scopeGeneration === scopeGenerationRef.current && refreshGeneration === refreshGenerationRef.current) {
        permissionErrorHandler('refresh pending requests', error)
      }
    }
  }, [])

  const resetPendingRequests = useCallback(() => {
    scopeGenerationRef.current += 1
    refreshGenerationRef.current += 1
    setPendingPermissionRequests([])
    setPendingQuestionRequests([])
    replyingIdsRef.current.clear()
    setIsReplying(false)
  }, [])

  return {
    pendingPermissionRequests,
    pendingQuestionRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
    handlePermissionReply,
    handleQuestionReply,
    handleQuestionReject,
    refreshPendingRequests,
    resetPendingRequests,
    isReplying,
  }
}

// ============================================
// SidePanel hooks - 缺失 session 补拉 / 编辑模式多选
// ============================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { getSession } from '../../../api/session'
import { pinnedSessionsStore } from '../../../store/pinnedSessionsStore'
import { MISSING_SESSION_RETRY_WINDOW_MS, getSelectionRange } from './SidePanel.utils'
import type { Session as ApiSession } from '../../../types/api/session'

interface SessionRef {
  sessionId: string
  directory?: string
}

/**
 * 补拉不在 sessions 列表中的 active/notification/pinned/selected session，
 * 并提供合并了 fetchedSessions 的 sessionLookup。
 */
export function useMissingSessions({
  sessions,
  busySessions,
  notifications,
  pinnedEntries,
  selectedSessionId,
  currentDirectory,
}: {
  sessions: ApiSession[]
  busySessions: ReadonlyArray<SessionRef>
  notifications: ReadonlyArray<SessionRef>
  pinnedEntries: ReadonlyArray<SessionRef>
  selectedSessionId: string | null
  currentDirectory: string | undefined
}) {
  // 缓存通过 API 拉取的 session 数据（sessions 列表中不存在的）
  const [fetchedSessions, setFetchedSessions] = useState<Record<string, ApiSession>>({})
  const [unavailablePinnedSessionIds, setUnavailablePinnedSessionIds] = useState<Set<string>>(() => new Set())
  // 防止 busySessions 等数组引用抖动时 cancel+重拉，导致 /session 风暴
  const inflightSessionIdsRef = useRef(new Set<string>())
  // 补拉失败的 session -> 失败时间戳：仅在时间窗内抑制，窗口过后自动重试
  const failedSessionIdsRef = useRef(new Map<string, number>())
  // 重试定时器到点后 bump，触发下方补拉 effect 重跑，让过期失败记录自动重试
  const [missingRetryTick, setMissingRetryTick] = useState(0)
  const missingRetryTimerRef = useRef<number | null>(null)

  // 为 active sessions 构建 sessionId -> ApiSession 的查找表
  const sessionLookup = useMemo(() => {
    const map = new Map<string, ApiSession>()
    for (const s of sessions) {
      map.set(s.id, s)
    }
    // fetchedSessions 作为补充（其他项目的 session）
    for (const [id, s] of Object.entries(fetchedSessions)) {
      if (!map.has(id)) {
        map.set(id, s)
      }
    }
    return map
  }, [sessions, fetchedSessions])

  // 需要补全的 session 集合：用内容 key 稳定，避免 busySessions 数组引用抖动触发重拉
  const missingSessionsKey = useMemo(() => {
    const byId = new Map<string, { sessionId: string; directory?: string; pinned?: boolean }>()
    const add = (sessionId: string, directory?: string, pinned?: boolean) => {
      if (sessionLookup.has(sessionId)) return
      const existing = byId.get(sessionId)
      if (existing) {
        byId.set(sessionId, {
          sessionId,
          directory: existing.directory || directory,
          pinned: existing.pinned || pinned,
        })
        return
      }
      byId.set(sessionId, { sessionId, directory, pinned })
    }

    for (const entry of busySessions) add(entry.sessionId, entry.directory)
    for (const entry of notifications) add(entry.sessionId, entry.directory)
    for (const entry of pinnedEntries) add(entry.sessionId, entry.directory, true)
    if (selectedSessionId) add(selectedSessionId, currentDirectory || undefined)

    return Array.from(byId.values())
      .map(e => `${e.sessionId}\0${e.directory ?? ''}\0${e.pinned ? '1' : '0'}`)
      .sort()
      .join('|')
  }, [busySessions, notifications, pinnedEntries, sessionLookup, selectedSessionId, currentDirectory])

  // 异步拉取不在 lookup 中的 active/notification/pinned/selected session
  useEffect(() => {
    const now = Date.now()
    const neededIds = new Set<string>()
    const missing: Array<{ sessionId: string; directory?: string; pinned?: boolean }> = []

    if (missingSessionsKey) {
      for (const token of missingSessionsKey.split('|')) {
        const [sessionId, directory, pinned] = token.split('\0')
        if (!sessionId) continue
        neededIds.add(sessionId)
        if (sessionLookup.has(sessionId)) continue
        if (inflightSessionIdsRef.current.has(sessionId)) continue
        const failedAt = failedSessionIdsRef.current.get(sessionId)
        if (failedAt !== undefined) {
          // 失败抑制只保留一个时间窗，窗口过后清掉记录并重试，避免缺失 session 被永久抑制
          if (now - failedAt < MISSING_SESSION_RETRY_WINDOW_MS) continue
          failedSessionIdsRef.current.delete(sessionId)
        }
        missing.push({
          sessionId,
          directory: directory || undefined,
          pinned: pinned === '1',
        })
      }
    }

    setUnavailablePinnedSessionIds(prev => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Set(prev)
      for (const entry of pinnedEntries) {
        if (sessionLookup.has(entry.sessionId) && next.delete(entry.sessionId)) changed = true
      }
      return changed ? next : prev
    })

    // 不再需要的失败记录清掉，session 再次出现时允许重试
    for (const sessionId of [...failedSessionIdsRef.current.keys()]) {
      if (!neededIds.has(sessionId)) failedSessionIdsRef.current.delete(sessionId)
    }

    if (missing.length > 0) {
      for (const entry of missing) {
        inflightSessionIdsRef.current.add(entry.sessionId)
      }

      void Promise.allSettled(
        missing.map(async entry => {
          try {
            const session = await getSession(entry.sessionId, entry.directory)
            inflightSessionIdsRef.current.delete(entry.sessionId)
            setFetchedSessions(prev => (prev[session.id] ? prev : { ...prev, [session.id]: session }))
            if (entry.pinned) {
              pinnedSessionsStore.update(session.id, {
                directory: session.directory || entry.directory,
                title: session.title || session.id.slice(0, 12) + '...',
              })
              setUnavailablePinnedSessionIds(prev => {
                if (!prev.has(session.id)) return prev
                const next = new Set(prev)
                next.delete(session.id)
                return next
              })
            }
          } catch {
            inflightSessionIdsRef.current.delete(entry.sessionId)
            // 失败记录带时间戳：窗口内跳过，窗口过后由下面的重试定时器自动再试
            failedSessionIdsRef.current.set(entry.sessionId, Date.now())
            if (missingRetryTimerRef.current === null) {
              missingRetryTimerRef.current = window.setTimeout(() => {
                missingRetryTimerRef.current = null
                setMissingRetryTick(prev => prev + 1)
              }, MISSING_SESSION_RETRY_WINDOW_MS)
            }
            if (entry.pinned) {
              setUnavailablePinnedSessionIds(prev => {
                if (prev.has(entry.sessionId)) return prev
                return new Set(prev).add(entry.sessionId)
              })
            }
          }
        }),
      )
    }

    // 按最早到期的失败记录调度重试 tick；没有待重试项就不保留定时器
    if (missingRetryTimerRef.current !== null) {
      clearTimeout(missingRetryTimerRef.current)
      missingRetryTimerRef.current = null
    }
    let nextRetryDelay: number | null = null
    for (const [sessionId, failedAt] of failedSessionIdsRef.current) {
      if (!neededIds.has(sessionId)) continue
      const remaining = MISSING_SESSION_RETRY_WINDOW_MS - (now - failedAt)
      if (remaining < (nextRetryDelay ?? Number.POSITIVE_INFINITY)) nextRetryDelay = Math.max(remaining, 0)
    }
    if (nextRetryDelay !== null) {
      missingRetryTimerRef.current = window.setTimeout(() => {
        missingRetryTimerRef.current = null
        setMissingRetryTick(prev => prev + 1)
      }, nextRetryDelay)
    }

    return () => {
      if (missingRetryTimerRef.current !== null) {
        clearTimeout(missingRetryTimerRef.current)
        missingRetryTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinnedEntries 的不可用标记清理由 sessionLookup/missingSessionsKey 变化覆盖
  }, [missingSessionsKey, sessionLookup, missingRetryTick])

  return { unavailablePinnedSessionIds, sessionLookup }
}

/**
 * 编辑模式：会话/项目多选（含 shift 范围选择）。
 */
export function useEditModeSelection(recentsSelectionRootRef: RefObject<HTMLDivElement | null>) {
  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set())
  const sessionSelectionAnchorIdRef = useRef<string | null>(null)
  const projectSelectionAnchorIdRef = useRef<string | null>(null)

  const getVisibleSelectionIds = useCallback((kind: 'session' | 'project') => {
    const root = recentsSelectionRootRef.current
    if (!root) return []

    return Array.from(root.querySelectorAll<HTMLElement>(`[data-selection-kind="${kind}"]`))
      .filter(element => element.getClientRects().length > 0)
      .map(element => element.dataset.selectionId)
      .filter((id): id is string => Boolean(id))
  }, [recentsSelectionRootRef])

  const toggleSessionSelection = useCallback(
    (sessionId: string, options?: { shiftKey?: boolean }) => {
      const anchorId = sessionSelectionAnchorIdRef.current
      const visibleIds = getVisibleSelectionIds('session')

      setSelectedSessionIds(prev => {
        if (options?.shiftKey && anchorId) {
          const range = getSelectionRange(visibleIds, anchorId, sessionId)
          if (range) {
            const next = new Set(prev)
            for (const id of range) next.add(id)
            return next
          }
        }

        const next = new Set(prev)
        if (next.has(sessionId)) next.delete(sessionId)
        else next.add(sessionId)
        return next
      })
      sessionSelectionAnchorIdRef.current = sessionId
    },
    [getVisibleSelectionIds],
  )

  const toggleProjectSelection = useCallback(
    (projectId: string, options?: { shiftKey?: boolean }) => {
      const anchorId = projectSelectionAnchorIdRef.current
      const visibleIds = getVisibleSelectionIds('project')

      setSelectedProjectIds(prev => {
        if (options?.shiftKey && anchorId) {
          const range = getSelectionRange(visibleIds, anchorId, projectId)
          if (range) {
            const next = new Set(prev)
            for (const id of range) next.add(id)
            return next
          }
        }

        const next = new Set(prev)
        if (next.has(projectId)) next.delete(projectId)
        else next.add(projectId)
        return next
      })
      projectSelectionAnchorIdRef.current = projectId
    },
    [getVisibleSelectionIds],
  )

  const exitEditMode = useCallback(() => {
    setIsEditMode(false)
    setSelectedSessionIds(new Set())
    setSelectedProjectIds(new Set())
    sessionSelectionAnchorIdRef.current = null
    projectSelectionAnchorIdRef.current = null
  }, [])

  const enterEditMode = useCallback(() => {
    setIsEditMode(true)
    sessionSelectionAnchorIdRef.current = null
    projectSelectionAnchorIdRef.current = null
  }, [])

  return {
    isEditMode,
    selectedSessionIds,
    setSelectedSessionIds,
    selectedProjectIds,
    setSelectedProjectIds,
    sessionSelectionAnchorIdRef,
    projectSelectionAnchorIdRef,
    toggleSessionSelection,
    toggleProjectSelection,
    exitEditMode,
    enterEditMode,
  }
}
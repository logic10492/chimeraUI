import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getSessionsPage,
  createSession,
  deleteSession,
  updateSession,
  subscribeToEvents,
  type ApiSession,
  type SessionListParams,
} from '../api'
import { serverStore } from '../store/serverStore'
import { pinnedSessionsStore } from '../store/pinnedSessionsStore'
import { autoDetectPathStyle, isSameDirectory } from '../utils'

interface UseSessionsOptions {
  /** 每页数量 */
  pageSize?: number
  /** 初始搜索词 */
  initialSearch?: string
  /** 只加载根会话 */
  rootsOnly?: boolean
  /** 按目录过滤 */
  directory?: string
  /** 延迟启用，用于懒加载 */
  enabled?: boolean
  /** 加载归档会话而不是活跃会话 */
  archived?: boolean
}

interface UseSessionsResult {
  sessions: ApiSession[]
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | null
  hasMore: boolean
  /** 搜索词 */
  search: string
  setSearch: (search: string) => void
  /** 加载更多 */
  loadMore: () => Promise<void>
  /** 刷新列表 */
  refresh: () => Promise<void>
  /** 创建新会话 */
  create: (title?: string) => Promise<ApiSession>
  /** 删除会话 */
  remove: (sessionId: string) => Promise<void>
  /** 归档会话 */
  archive: (sessionId: string) => Promise<void>
  /** 恢复归档会话 */
  restore: (sessionId: string) => Promise<void>
  /** 本地更新会话 */
  patchLocalSession: (sessionId: string, patch: Partial<ApiSession>) => void
  /** 本地移除会话 */
  removeLocalSession: (sessionId: string) => void
}

export function useSessions(options: UseSessionsOptions = {}): UseSessionsResult {
  const { pageSize = 20, initialSearch = '', rootsOnly = true, directory, enabled = true, archived = false } = options

  // 标准化 directory 路径 (移除末尾斜杠，统一正斜杠)
  const normalizedDirectory = directory ? directory.replace(/\\/g, '/').replace(/\/$/, '') : undefined

  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState(initialSearch)

  // 用于跟踪最后一次请求，避免竞态条件
  const requestIdRef = useRef(0)
  // 防抖 timer
  const searchTimerRef = useRef<number | null>(null)
  // 下一页游标；仅由服务端响应更新，避免 SSE 重排影响分页边界
  const nextCursorRef = useRef<string | undefined>(undefined)
  const searchRef = useRef(search)
  // 防止 onReconnected 密集触发时重复请求
  const isFetchingRef = useRef(false)
  const queuedReconnectRefreshRef = useRef(false)
  const retryTimerRef = useRef<number | null>(null)
  const fetchSessionsRef = useRef<
    (params?: Omit<SessionListParams, 'cursor'> & { append?: boolean; retryAttempt?: number }) => Promise<void>
  >(() => Promise.resolve())

  useEffect(() => {
    searchRef.current = search
  }, [search])

  const matchesDirectory = useCallback(
    (session: ApiSession) => !normalizedDirectory || isSameDirectory(normalizedDirectory, session.directory),
    [normalizedDirectory],
  )

  // 获取固定大小的会话页；刷新替换，loadMore 追加并去重
  const fetchSessions = useCallback(
    async (params: Omit<SessionListParams, 'cursor'> & { append?: boolean; retryAttempt?: number } = {}) => {
      if (!enabled) return

      const { append = false, retryAttempt = 0, ...queryParams } = params
      const requestId = ++requestIdRef.current
      isFetchingRef.current = true

      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setError(null)
      }

      try {
        const page = await getSessionsPage({
          roots: rootsOnly,
          limit: pageSize,
          directory: normalizedDirectory,
          ...(archived ? { archived: true } : {}),
          ...(append && nextCursorRef.current ? { cursor: nextCursorRef.current } : {}),
          ...queryParams,
        })
        const data = page.items

        // 检查是否是最新的请求
        if (requestId !== requestIdRef.current) return

        if (data.length > 0 && data[0].directory) {
          autoDetectPathStyle(data[0].directory)
        }

        nextCursorRef.current = page.nextCursor
        setSessions(prev => {
          if (!append) return data
          const ids = new Set(prev.map(session => session.id))
          return [...prev, ...data.filter(session => !ids.has(session.id))]
        })
        setHasMore(Boolean(page.nextCursor))
      } catch (e) {
        if (requestId !== requestIdRef.current) return
        setError(e instanceof Error ? e : new Error('Failed to fetch sessions'))
        if (!append) {
          if (retryAttempt < 3) {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
            retryTimerRef.current = window.setTimeout(() => {
              if (requestId !== requestIdRef.current) return
              void fetchSessions({ ...queryParams, retryAttempt: retryAttempt + 1 })
            }, [500, 1500, 3000][retryAttempt])
          } else {
            setSessions([])
            setHasMore(false)
          }
        }
      } finally {
        if (requestId === requestIdRef.current) {
          isFetchingRef.current = false
          setIsLoading(false)
          setIsLoadingMore(false)
          if (queuedReconnectRefreshRef.current) {
            queuedReconnectRefreshRef.current = false
            nextCursorRef.current = undefined
            setSessions([])
            void fetchSessionsRef.current({ search: searchRef.current || undefined })
          }
        }
      }
    },
    [rootsOnly, normalizedDirectory, enabled, archived, pageSize],
  )

  fetchSessionsRef.current = fetchSessions

  // 初始加载和搜索变化时重新加载
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      setIsLoadingMore(false)
      return
    }

    // 搜索或 enabled 变化时重置游标
    nextCursorRef.current = undefined

    // 防抖处理搜索
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }

    searchTimerRef.current = window.setTimeout(
      () => {
        fetchSessions({ search: search || undefined })
      },
      search ? 300 : 0,
    ) // 有搜索词时延迟 300ms，无搜索词时立即执行

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
      }
    }
  }, [search, fetchSessions, enabled, pageSize])

  useEffect(() => {
    if (!enabled) return

    const unsubscribe = subscribeToEvents({
      onSessionCreated: session => {
        if (session.parentID) return
        if (archived || session.time.archived != null) return
        if (!matchesDirectory(session)) return

        if (searchRef.current) {
          void fetchSessionsRef.current({ search: searchRef.current || undefined })
          return
        }

        setSessions(prev => {
          if (prev.some(item => item.id === session.id)) return prev
          return [session, ...prev]
        })
      },
      onSessionUpdated: session => {
        if (session.parentID) return
        const belongsInView = archived ? session.time.archived != null : session.time.archived == null

        if (!belongsInView) {
          setSessions(prev => prev.filter(item => item.id !== session.id))
          return
        }

        if (searchRef.current) {
          if (matchesDirectory(session)) {
            void fetchSessionsRef.current({ search: searchRef.current || undefined })
          } else {
            setSessions(prev => prev.filter(item => item.id !== session.id))
          }
          return
        }

        setSessions(prev => {
          const index = prev.findIndex(item => item.id === session.id)

          if (!matchesDirectory(session)) {
            return index === -1 ? prev : prev.filter(item => item.id !== session.id)
          }

          if (index === -1) {
            return [session, ...prev]
          }

          const updated = prev.filter(item => item.id !== session.id)
          return [session, ...updated]
        })
      },
      onSessionDeleted: sessionId => {
        setSessions(prev => prev.filter(item => item.id !== sessionId))
      },
      onReconnected: reason => {
        if (reason === 'server-switch') return
        if (isFetchingRef.current) {
          queuedReconnectRefreshRef.current = true
          return
        }
        nextCursorRef.current = undefined
        setSessions([])
        void fetchSessionsRef.current({ search: searchRef.current || undefined })
      },
    })

    return unsubscribe
  }, [enabled, matchesDirectory, pageSize, archived])

  useEffect(() => {
    if (!enabled) return

    return serverStore.onServerChange(() => {
      nextCursorRef.current = undefined
      setSessions([])
      void fetchSessionsRef.current({ search: searchRef.current || undefined })
    })
  }, [enabled, pageSize])

  // 加载更多：使用服务端游标请求固定大小的下一页
  const loadMore = useCallback(async () => {
    if (!enabled || isLoadingMore || !hasMore || sessions.length === 0 || !nextCursorRef.current) return

    await fetchSessions({
      search: search || undefined,
      append: true,
    })
  }, [sessions, search, hasMore, isLoadingMore, fetchSessions, enabled])

  // 刷新
  const refresh = useCallback(async () => {
    if (!enabled) return
    nextCursorRef.current = undefined
    await fetchSessions({ search: search || undefined })
  }, [search, fetchSessions, enabled])

  // 创建新会话
  const create = useCallback(
    async (title?: string) => {
      // 创建时也要传 directory
      const newSession = await createSession({
        title,
        directory: normalizedDirectory,
      })

      if (searchRef.current) {
        void fetchSessionsRef.current({ search: searchRef.current || undefined })
      } else {
        setSessions(prev => {
          if (prev.some(session => session.id === newSession.id)) return prev
          return [newSession, ...prev]
        })
      }

      return newSession
    },
    [normalizedDirectory],
  )

  // 删除会话
  const remove = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId, normalizedDirectory)
      pinnedSessionsStore.unpin(sessionId)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
    },
    [normalizedDirectory],
  )

  const archive = useCallback(
    async (sessionId: string) => {
      await updateSession(sessionId, { time: { archived: Date.now() } }, normalizedDirectory)
      setSessions(prev => prev.filter(session => session.id !== sessionId))
    },
    [normalizedDirectory],
  )

  const restore = useCallback(
    async (sessionId: string) => {
      await updateSession(sessionId, { time: { archived: null } }, normalizedDirectory)
      setSessions(prev => prev.filter(session => session.id !== sessionId))
    },
    [normalizedDirectory],
  )

  const patchLocalSession = useCallback((sessionId: string, patch: Partial<ApiSession>) => {
    setSessions(prev => prev.map(session => (session.id === sessionId ? { ...session, ...patch } : session)))
  }, [])

  const removeLocalSession = useCallback((sessionId: string) => {
    setSessions(prev => prev.filter(session => session.id !== sessionId))
  }, [])

  return {
    sessions,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    search,
    setSearch,
    loadMore,
    refresh,
    create,
    remove,
    archive,
    restore,
    patchLocalSession,
    removeLocalSession,
  }
}

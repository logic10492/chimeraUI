// ============================================
// useGlobalEvents - 全局 SSE 事件订阅
// ============================================
//
// 职责：
// 1. 订阅全局 SSE 事件流
// 2. 将事件分发到 messageStore
// 3. 追踪子 session 关系（用于权限请求冒泡）
// 4. 与具体 session 无关，处理所有 session 的事件

import { useEffect, useLayoutEffect, useRef } from 'react'
import { messageStore, childSessionStore, paneLayoutStore, serverStore } from '../store'
import { activeSessionStore } from '../store/activeSessionStore'
import { commandProgressStore } from '../store/commandProgressStore'
import { notificationEventSettingsStore } from '../store/notificationEventSettingsStore'
import { notificationStore } from '../store/notificationStore'
import { runtimeInvalidationStore } from '../store/runtimeInvalidationStore'
import { soundStore } from '../store/soundStore'
import { playNotificationSoundDeduped } from '../utils/notificationSoundBridge'
import { clearSessionRuntimeState } from '../utils/sessionLifecycle'
import {
  subscribeToEvents,
  getSessionStatus,
  getPendingPermissions,
  getPendingQuestions,
  broadcastRuntimeResync,
} from '../api'
import { invalidateRootDirectoryCache } from '../api/file'
import { replyPermission } from '../api/permission'
import { autoApproveStore } from '../store/autoApproveStore'
import { serverDisposedDirectoryStore } from '../store/serverDisposedDirectoryStore'
import { activeDirectoriesKey } from '../utils/activeScope'
import { isSameDirectory } from '../utils'
import { useNotification } from './useNotification'
import type { ApiMessage, ApiPart, ApiPermissionRequest, ApiQuestionRequest, EventScope } from '../api/types'
import type { SessionStatusMap } from '../types/api/session'

// ============================================
// Session-level pub/sub 消费者注册
// ============================================
//
// 支持多个消费者（每个 pane 一个）按 sessionId 注册回调。
// SSE 事件到达后，按 sessionId 找到匹配的消费者分发。

/** 消费者可以注册的回调类型（与 GlobalEventsCallbacks 的子集对应） */
export type SessionResyncReason = 'network' | 'server-switch' | 'event-gap' | 'dispose'

export interface SessionEventCallbacks {
  onPermissionAsked?: (request: ApiPermissionRequest) => void
  onPermissionReplied?: (data: { sessionID: string; requestID: string }) => void
  onQuestionAsked?: (request: ApiQuestionRequest) => void
  onQuestionReplied?: (data: { sessionID: string; requestID: string }) => void
  onQuestionRejected?: (data: { sessionID: string; requestID: string }) => void
  onScrollRequest?: () => void
  onSessionIdle?: (sessionID: string) => void
  onSessionError?: (sessionID: string) => void
  onReconnected?: (reason: SessionResyncReason, serverID: string) => void
}

interface SessionConsumer {
  sessionId: string | null
  callbacks: SessionEventCallbacks
}

/** 全局消费者注册表 */
const sessionConsumers = new Map<string, SessionConsumer>()

/**
 * 注册一个 session 级事件消费者。
 * @param consumerId 唯一标识（通常用 paneId）
 * @param sessionId 关心的 sessionId（null = 不接收事件）
 * @param callbacks 回调函数集
 * @returns 注销函数
 */
export function registerSessionConsumer(
  consumerId: string,
  sessionId: string | null,
  callbacks: SessionEventCallbacks,
): () => void {
  sessionConsumers.set(consumerId, { sessionId, callbacks })
  return () => {
    sessionConsumers.delete(consumerId)
  }
}

/** 更新已注册消费者的 sessionId（pane 切换 session 时，无需重新注册） */
export function updateConsumerSessionId(consumerId: string, sessionId: string | null) {
  const c = sessionConsumers.get(consumerId)
  if (c) c.sessionId = sessionId
}

/** 按 sessionId 找到所有匹配的消费者回调（包括子 session 冒泡） */
function dispatchToConsumers(sessionId: string, invoke: (cb: SessionEventCallbacks) => void): boolean {
  let dispatched = false
  for (const consumer of sessionConsumers.values()) {
    if (!consumer.sessionId) continue
    if (consumer.sessionId === sessionId || childSessionStore.belongsToSession(sessionId, consumer.sessionId)) {
      invoke(consumer.callbacks)
      dispatched = true
    }
  }
  return dispatched
}

/** 检查是否有任何消费者关心此 sessionId */
function hasConsumerForSession(sessionId: string): boolean {
  for (const consumer of sessionConsumers.values()) {
    if (!consumer.sessionId) continue
    if (consumer.sessionId === sessionId) return true
    if (childSessionStore.belongsToSession(sessionId, consumer.sessionId)) return true
  }
  return false
}

/** 检查是否有“其他”消费者仍在使用该 sessionId（排除当前 pane 自己） */
export function hasOtherConsumerForSession(sessionId: string, consumerId: string): boolean {
  for (const [id, consumer] of sessionConsumers.entries()) {
    if (id === consumerId) continue
    if (!consumer.sessionId) continue
    if (consumer.sessionId === sessionId) return true
    if (childSessionStore.belongsToSession(sessionId, consumer.sessionId)) return true
  }
  return false
}

// ============================================
// 待处理请求缓存 - 处理 permission/question 事件先于 session.created 到达的时序问题
// 同一 session 可能有多个 pending 请求，所以用数组
// ============================================
interface PendingRequest<T> {
  request: T
  timestamp: number
}

const pendingPermissions = new Map<string, PendingRequest<ApiPermissionRequest>[]>()
const pendingQuestions = new Map<string, PendingRequest<ApiQuestionRequest>[]>()

// 5秒后过期，防止内存泄漏
const PENDING_TIMEOUT = 5000

function cleanupExpired<T>(map: Map<string, PendingRequest<T>[]>) {
  const now = Date.now()
  for (const [key, arr] of map) {
    const filtered = arr.filter(item => now - item.timestamp <= PENDING_TIMEOUT)
    if (filtered.length === 0) {
      map.delete(key)
    } else if (filtered.length !== arr.length) {
      map.set(key, filtered)
    }
  }
}

function addPending<T>(map: Map<string, PendingRequest<T>[]>, sessionID: string, request: T) {
  const arr = map.get(sessionID) || []
  arr.push({ request, timestamp: Date.now() })
  map.set(sessionID, arr)
}

function drainPending<T>(map: Map<string, PendingRequest<T>[]>, sessionID: string): T[] {
  const arr = map.get(sessionID)
  if (!arr || arr.length === 0) return []
  map.delete(sessionID)
  return arr.map(item => item.request)
}

function getScopeKey(directories?: string[]) {
  if (!directories || directories.length === 0) return '__global__'
  // 排序后 join：内容相同、顺序不同的目录集合产生同一 key（W2② 稳定 key）
  return [...directories].sort().join('|')
}

function removePendingByRequestId<T extends { id: string }>(
  map: Map<string, PendingRequest<T>[]>,
  sessionID: string,
  requestID: string,
) {
  const arr = map.get(sessionID)
  if (!arr || arr.length === 0) return

  const filtered = arr.filter(item => item.request.id !== requestID)
  if (filtered.length === 0) {
    map.delete(sessionID)
  } else if (filtered.length !== arr.length) {
    map.set(sessionID, filtered)
  }
}

async function fetchActiveScopeData(serverID: string, directories?: string[]) {
  const scopes = directories && directories.length > 0 ? directories : [undefined]
  const results = await Promise.all(
    scopes.map(async directory => {
      const [statusMap, permissions, questions] = await Promise.all([
        getSessionStatus({ serverID, directory }).catch(() => ({}) as SessionStatusMap),
        getPendingPermissions(undefined, directory).catch(() => []),
        getPendingQuestions(undefined, directory).catch(() => []),
      ])

      return { directory, statusMap, permissions, questions }
    }),
  )

  const mergedStatusMap: SessionStatusMap = {}
  const permissionMap = new Map<string, ApiPermissionRequest>()
  const questionMap = new Map<string, ApiQuestionRequest>()
  const sessionMetaEntries: Array<{ sessionId: string; directory?: string; serverID: string }> = []

  results.forEach(({ directory, statusMap, permissions, questions }) => {
    Object.assign(mergedStatusMap, statusMap)

    if (directory) {
      Object.keys(statusMap).forEach(sessionId => {
        sessionMetaEntries.push({ sessionId, directory, serverID })
      })
    }

    permissions.forEach(permission => {
      if (directory) {
        sessionMetaEntries.push({ sessionId: permission.sessionID, directory, serverID })
      }
      permissionMap.set(permission.id, permission)
    })

    questions.forEach(question => {
      if (directory) {
        sessionMetaEntries.push({ sessionId: question.sessionID, directory, serverID })
      }
      questionMap.set(question.id, question)
    })
  })

  return {
    statusMap: mergedStatusMap,
    permissions: Array.from(permissionMap.values()),
    questions: Array.from(questionMap.values()),
    sessionMetaEntries,
  }
}

// 与服务器端 InstanceStore.LRU_DISPOSE_REASONS 对应：只有 LRU/压力驱逐降级为 stale 标记
// （0 自动重拉，惰性恢复）；reload / 显式 dispose 仍按原逻辑立即 resync。
// memory-pressure = W1 内存预算压力驱逐（同为「被回收」语义，同样走 stale 标记）。
const LRU_DISPOSE_REASONS = new Set(['idle-sweep', 'post-load-lru', 'post-request-lru', 'memory-pressure'])
// 同一 scope 的连续非 LRU dispose resync 在该窗口内合并为一次拉取
const DISPOSE_RESYNC_DEBOUNCE_MS = 250

/** 检查 sessionID 是否属于当前活跃的 session family。
 * 依次检查：
 *   1. focused pane 的 session family
 *   2. pub/sub 消费者注册表（其他 pane）
 */
function belongsToCurrentSession(sessionId: string): boolean {
  const focusedSessionId = paneLayoutStore.getFocusedSessionId()

  // 检查当前 focused pane 的 session family
  if (focusedSessionId) {
    if (sessionId === focusedSessionId) return true
    if (childSessionStore.belongsToSession(sessionId, focusedSessionId)) return true
  }

  // 检查 pub/sub 消费者注册表（多 pane 模式下各 pane 注册的 session）
  if (hasConsumerForSession(sessionId)) return true

  return false
}

/**
 * 检查 session 是否被某个 pane 直接打开。
 *
 * 和 belongsToCurrentSession() 的区别：
 * - belongsToCurrentSession(): 包含当前 session 的子 session family
 * - isSessionDirectlyOpen(): 只认 pane 直接打开的 session 本身
 *
 * 这样父 session 正在查看时，子 session 的事件可以继续在界面内冒泡，
 * 但不会再被当成“当前 session 自己”的提示音来播放。
 */
function isSessionDirectlyOpen(sessionId: string): boolean {
  const focusedSessionId = paneLayoutStore.getFocusedSessionId()
  if (focusedSessionId === sessionId) return true

  for (const consumer of sessionConsumers.values()) {
    if (consumer.sessionId === sessionId) return true
  }

  return false
}

export function useGlobalEvents(directories?: string[], options?: { pinnedDirectories?: string[] }) {
  const directoriesRef = useRef<string[] | undefined>(directories)
  const pinnedDirectoriesRef = useRef<string[] | undefined>(options?.pinnedDirectories)
  const refreshRef = useRef<((strategy?: 'replace' | 'merge') => void) | null>(null)
  const initializedDirectoriesRef = useRef(false)
  // 上一次触发刷新的目录内容 key（含 pinned）：内容不变时跳过刷新（W2②）
  const lastScopeKeyRef = useRef<string | null>(null)
  const { sendNotification } = useNotification()

  useEffect(() => {
    // 节流滚动
    let scrollPending = false
    const pendingScrollSessionIds = new Set<string>()
    let fetchVersion = 0
    let activeFetchVersion = 0
    let disposed = false
    let disposeResyncTimer: ReturnType<typeof setTimeout> | undefined
    const latePendingRequests = new Map<
      string,
      {
        requestId: string
        sessionId: string
        type: 'permission' | 'question'
        description?: string
        scopeKey: string
        directory?: string
      }
    >()

    const scheduleScroll = (sessionId: string) => {
      pendingScrollSessionIds.add(sessionId)
      if (scrollPending) return
      scrollPending = true
      requestAnimationFrame(() => {
        scrollPending = false

        // 分发到 pub/sub 消费者
        for (const sid of pendingScrollSessionIds) {
          dispatchToConsumers(sid, cb => cb.onScrollRequest?.())
        }
        pendingScrollSessionIds.clear()
      })
    }

    // 自动全量刷新要跳过的“休眠”目录：被服务器 LRU 驱逐且用户当前没有在看。
    // 用户正在看的目录（route/current/pane）仍然拉取——那是真实需求，服务器端
    // 振荡保护会阻止它再次被立即驱逐。
    const getFetchDirectories = () => {
      const serverID = serverStore.getActiveServerId()
      const dirs = directoriesRef.current
      if (!dirs || dirs.length === 0) return dirs
      return dirs.filter(directory => {
        if (!serverDisposedDirectoryStore.isDisposed(serverID, directory)) return true
        return pinnedDirectoriesRef.current?.some(pinned => isSameDirectory(pinned, directory)) ?? false
      })
    }

    // ============================================
    // 拉取 session 状态 + pending requests（初始化 & 重连共用）
    // ============================================

    const fetchAndInitialize = (strategy: 'replace' | 'merge' = 'replace') => {
      const currentVersion = ++fetchVersion
      const serverID = serverStore.getActiveServerId()
      activeFetchVersion = currentVersion
      void fetchActiveScopeData(serverID, getFetchDirectories())
        .then(({ statusMap, permissions, questions, sessionMetaEntries }) => {
          if (disposed || currentVersion !== fetchVersion || serverStore.getActiveServerId() !== serverID) return
          if (strategy === 'merge') {
            activeSessionStore.mergeStatusRefresh(statusMap)
            activeSessionStore.mergePendingRequests(permissions, questions)
          } else {
            activeSessionStore.initialize(statusMap)
            activeSessionStore.initializePendingRequests(permissions, questions)
          }
          const currentDirectories = directoriesRef.current
          const currentScopeKey = getScopeKey(directoriesRef.current)
          for (const pending of latePendingRequests.values()) {
            const matchesScope = pending.directory
              ? !currentDirectories || currentDirectories.length === 0 || currentDirectories.includes(pending.directory)
              : pending.scopeKey === currentScopeKey
            if (!matchesScope) continue
            activeSessionStore.addPendingRequest(
              pending.requestId,
              pending.sessionId,
              pending.type,
              pending.description,
            )
          }
          activeSessionStore.setSessionMetaBulk(sessionMetaEntries)
        })
        .catch(() => {
          // best effort: 下次目录切换或 SSE 重连会再拉一次
        })
        .finally(() => {
          if (currentVersion === fetchVersion) {
            activeFetchVersion = 0
          }
        })
    }

    const refreshActiveServerHealth = () => {
      const activeServerId = serverStore.getActiveServerId()
      void serverStore.checkHealth(activeServerId).catch(() => {})
    }

    const isActiveScope = (scope: EventScope) => {
      if (scope.serverID !== serverStore.getActiveServerId()) return false
      const activeDirectories = directoriesRef.current
      if (scope.directory === 'global' || !activeDirectories || activeDirectories.length === 0) return true
      return activeDirectories.includes(scope.directory)
    }

    const invalidateRootCaches = (scope: EventScope) => {
      const activeDirectories = directoriesRef.current
      const directoriesToInvalidate =
        scope.directory === 'global'
          ? activeDirectories && activeDirectories.length > 0
            ? activeDirectories
            : [undefined]
          : [scope.directory]

      directoriesToInvalidate.forEach(directory => {
        invalidateRootDirectoryCache({ serverID: scope.serverID, directory })
      })
      if (scope.workspace) {
        invalidateRootDirectoryCache({ serverID: scope.serverID, workspace: scope.workspace })
      }
    }

    const invalidateRuntimeScope = (scope: EventScope, event: 'resync' | 'disposed') => {
      invalidateRootCaches(scope)
      runtimeInvalidationStore.emit({ type: 'file', scope, event })
      runtimeInvalidationStore.emit({ type: 'lsp', scope })
    }

    const resyncRuntime = (scope: EventScope, reason: SessionResyncReason, event: 'resync' | 'disposed' = 'resync') => {
      if (!isActiveScope(scope)) return
      pendingPermissions.clear()
      pendingQuestions.clear()
      latePendingRequests.clear()
      messageStore.markAllSessionsStale()
      invalidateRuntimeScope(scope, event)
      refreshActiveServerHealth()
      if (reason === 'dispose') {
        // 多个目录被连续驱逐时合并为一次拉取，避免 N 个 disposed 事件放大成 N 次全量刷新
        if (disposeResyncTimer) clearTimeout(disposeResyncTimer)
        disposeResyncTimer = setTimeout(() => {
          disposeResyncTimer = undefined
          fetchAndInitialize()
        }, DISPOSE_RESYNC_DEBOUNCE_MS)
      } else {
        fetchAndInitialize()
      }
      for (const consumer of sessionConsumers.values()) {
        consumer.callbacks.onReconnected?.(reason, scope.serverID)
      }
      // pane 消费者只覆盖当前打开的 session；全局订阅者（如会话列表）住在 events.ts 的
      // allSubscribers，event-gap / 非 LRU dispose 若不广播会长期漂移。
      // 复用 broadcastReconnected 的 2s cooldown 作为风暴保护；network / server-switch
      // 本身已由该广播触发，不重复发起。LRU 驱逐已在入口降级为 stale 标记（W2④），
      // 不会到达这里；event-gap 保留全量 resync 作为唯一兜底（W2⑤）。
      if (reason === 'event-gap' || reason === 'dispose') broadcastRuntimeResync(scope.serverID)
    }

    // 目录实例被处置后的本地清理（不触发任何网络请求）：
    // 正在 pane 中打开的 session 保留显示与数据（服务端会按需 boot），
    // 未打开的 session 清空运行时状态，等下次打开时惰性重拉。
    const clearDisposedScopeState = (scope: EventScope) => {
      const openSessionIds = new Set(
        paneLayoutStore
          .allLeaves()
          .map(leaf => leaf.sessionId)
          .filter((sessionId): sessionId is string => !!sessionId),
      )
      const sessionIds = activeSessionStore.getSessionIdsForScope({
        serverID: scope.serverID,
        directory: scope.directory === 'global' ? undefined : scope.directory,
        workspace: scope.workspace,
      })
      for (const sessionId of sessionIds) {
        pendingPermissions.delete(sessionId)
        pendingQuestions.delete(sessionId)
        if (openSessionIds.has(sessionId)) continue
        clearSessionRuntimeState(sessionId, scope.serverID)
        paneLayoutStore.clearSession(sessionId)
      }
    }

    // 非 LRU 的显式处置（reload / 手动 dispose）：本地清理 + 全量 resync。
    // LRU 驱逐不走这里（W2④ 已在入口降级为 stale 标记）。
    const disposeRuntimeScope = (scope: EventScope) => {
      if (!isActiveScope(scope)) return
      clearDisposedScopeState(scope)
      resyncRuntime(scope, 'dispose', 'disposed')
    }

    const sendSystemNotification = (
      type: 'permission' | 'question' | 'completed' | 'error',
      sessionID: string,
      label: string,
      body: string,
      scope: EventScope,
    ) => {
      if (!notificationEventSettingsStore.isSystemEnabled(type)) return
      const meta = activeSessionStore.getSessionMeta(sessionID, scope.serverID)
      const sessionLabel = meta?.title || `Session ${sessionID.slice(0, 6)}`
      void sendNotification(`${sessionLabel} - ${label}`, body, {
        sessionID,
        serverID: scope.serverID,
        directory: meta?.directory ?? (scope.directory === 'global' ? undefined : scope.directory),
      })
    }

    const markPermissionReplied = (sessionID: string, requestID: string) => {
      removePendingByRequestId(pendingPermissions, sessionID, requestID)
      latePendingRequests.delete(requestID)
      activeSessionStore.resolvePendingRequest(requestID)

      // Broadcast to ALL consumers regardless of session match.
      // Each consumer clears its local state by requestID (which is globally unique),
      // so a no-op for consumers that don't have this request.
      // This fixes the case where global auto-approve's replyPermission succeeds
      // but belongsToCurrentSession returns false, leaving stale entries in
      // pendingPermissionRequests that can never be cleared.
      for (const { callbacks } of sessionConsumers.values()) {
        callbacks.onPermissionReplied?.({ sessionID, requestID })
      }
    }

    refreshRef.current = fetchAndInitialize

    const approveGlobalPendingPermissions = () => {
      if (!autoApproveStore.approvePendingOnFullAuto || autoApproveStore.fullAutoMode !== 'global') return

      const fetchDirectories = getFetchDirectories()
      const directoriesToFetch = fetchDirectories && fetchDirectories.length > 0 ? fetchDirectories : [undefined]

      void Promise.all(
        directoriesToFetch.map(async directory => {
          const permissions = await getPendingPermissions(undefined, directory).catch(() => [])

          await Promise.all(
            permissions.map(async request => {
              if (!autoApproveStore.claimAutoReply(request.id)) return

              const dir = directory ?? activeSessionStore.getSessionMeta(request.sessionID)?.directory
              try {
                await replyPermission(request.id, 'once', undefined, dir, request.sessionID)
                if (!disposed) markPermissionReplied(request.sessionID, request.id)
              } catch {
                autoApproveStore.releaseAutoReply(request.id)
              }
            }),
          )
        }),
      )
    }

    const unsubscribeAutoApprove = autoApproveStore.subscribe(approveGlobalPendingPermissions)
    const unsubscribeServerChange = serverStore.onServerChange(serverId => {
      fetchVersion += 1
      activeFetchVersion = 0
      pendingPermissions.clear()
      pendingQuestions.clear()
      latePendingRequests.clear()
      void serverStore.checkHealth(serverId).catch(() => {})
    })

    const unsubscribe = subscribeToEvents({
      // ============================================
      // Message Events → messageStore
      // ============================================

      onMessageUpdated: (apiMsg: ApiMessage, scope) => {
        if (!isActiveScope(scope)) return
        messageStore.handleMessageUpdated(apiMsg)
      },

      onMessageRemoved: (data, scope) => {
        if (!isActiveScope(scope)) return
        messageStore.removeMessage(data.sessionID, data.messageID)
      },

      onPartUpdated: (apiPart: ApiPart, scope) => {
        if (!isActiveScope(scope)) return
        if ('sessionID' in apiPart && 'messageID' in apiPart) {
          messageStore.handlePartUpdated(apiPart as ApiPart & { sessionID: string; messageID: string })
          scheduleScroll(apiPart.sessionID)
        }
      },

      onPartDelta: (data, scope) => {
        if (!isActiveScope(scope)) return
        messageStore.handlePartDelta(data)
        scheduleScroll(data.sessionID)
      },

      onPartRemoved: (data, scope) => {
        if (!isActiveScope(scope)) return
        messageStore.handlePartRemoved(data)
      },

      // ============================================
      // Session Events → childSessionStore
      // ============================================

      onSessionCreated: (session, scope) => {
        if (!isActiveScope(scope)) return
        if (session.parentID) {
          childSessionStore.registerChildSession(session)
          // session.created 失效事件：追加进已拉取的 children 缓存，保持热数据新鲜（W3①）
          childSessionStore.appendCachedChildSession(session)

          if (belongsToCurrentSession(session.id)) {
            for (const req of drainPending(pendingPermissions, session.id)) {
              dispatchToConsumers(req.sessionID, cb => cb.onPermissionAsked?.(req))
            }
            for (const req of drainPending(pendingQuestions, session.id)) {
              dispatchToConsumers(req.sessionID, cb => cb.onQuestionAsked?.(req))
            }
          }
        }

        activeSessionStore.setSessionMeta(
          session.id,
          session.title,
          scope.directory === 'global' ? session.directory : scope.directory,
          scope.serverID,
          scope.workspace ?? session.workspaceID,
        )

        cleanupExpired(pendingPermissions)
        cleanupExpired(pendingQuestions)
      },

      onSessionIdle: (data, scope) => {
        if (!isActiveScope(scope)) return
        messageStore.handleSessionIdle(data.sessionID)
        childSessionStore.markIdle(data.sessionID)
        const dispatched = dispatchToConsumers(data.sessionID, cb => cb.onSessionIdle?.(data.sessionID))
        if (dispatched) {
          sendSystemNotification('completed', data.sessionID, 'Session completed', 'Session completed', scope)
        }
      },

      // ============================================
      // Command Events → commandProgressStore
      // ============================================

      onCommandStarted: (data, scope) => {
        if (!isActiveScope(scope)) return
        commandProgressStore.started(data.sessionID, data)
      },
      onCommandProgress: (data, scope) => {
        if (!isActiveScope(scope)) return
        commandProgressStore.update(data.sessionID, data)
      },
      onCommandExecuted: (data, scope) => {
        if (!isActiveScope(scope)) return
        commandProgressStore.clear(data.sessionID)
      },

      onSessionError: (error, scope) => {
        if (!isActiveScope(scope)) return
        const isAbort = error.name === 'MessageAbortedError' || error.name === 'AbortError'
        if (!isAbort && import.meta.env.DEV) {
          console.warn('[GlobalEvents] Session error:', error)
        }
        if (!error.sessionID) return

        messageStore.handleSessionError(error.sessionID)
        childSessionStore.markError(error.sessionID)
        if (!isAbort) {
          activeSessionStore.updateStatus(error.sessionID, { type: 'idle' })
          const meta = activeSessionStore.getSessionMeta(error.sessionID, scope.serverID)
          if (!belongsToCurrentSession(error.sessionID)) {
            const sessionLabel = meta?.title || error.sessionID.slice(0, 8)
            notificationStore.push(
              'error',
              sessionLabel,
              'Session error',
              error.sessionID,
              meta?.directory ?? (scope.directory === 'global' ? undefined : scope.directory),
            )
          } else if (isSessionDirectlyOpen(error.sessionID) && soundStore.getSnapshot().currentSessionEnabled) {
            playNotificationSoundDeduped('error')
          }
        }

        const dispatched = dispatchToConsumers(error.sessionID, cb => cb.onSessionError?.(error.sessionID))
        if (!isAbort && dispatched) {
          sendSystemNotification('error', error.sessionID, 'Session error', 'Session error', scope)
        }
      },

      onSessionUpdated: (session, scope) => {
        if (!isActiveScope(scope)) return
        activeSessionStore.setSessionMeta(
          session.id,
          session.title,
          scope.directory === 'global' ? session.directory : scope.directory,
          scope.serverID,
          scope.workspace ?? session.workspaceID,
        )
        if (session.parentID) {
          childSessionStore.registerChildSession(session)
          // session.updated 涉及子 session：原位修补已拉取的 children 缓存（W3① 失效事件）
          childSessionStore.patchCachedChildSession(session)
        }

        if (session.title && messageStore.getSessionState(session.id)) {
          messageStore.updateSessionMetadata(session.id, { title: session.title })
        }
      },

      onSessionDeleted: (sessionId, scope) => {
        if (!isActiveScope(scope)) return
        const removedSessionIds = childSessionStore.getSessionAndDescendants(sessionId)
        clearSessionRuntimeState(sessionId, scope.serverID)
        for (const id of removedSessionIds) paneLayoutStore.clearSession(id)
      },

      onServerConnected: (data, scope) => {
        if (!isActiveScope(scope)) return
        serverStore.applyServerConnectedTimestamp(scope.serverID, data.timestamp)
      },

      // ============================================
      // Permission Events → callbacks (通过 ref 调用)
      // 关键变化：不仅处理当前 session，也处理子 session 的权限请求
      // 时序处理：如果 session 还没注册，缓存请求等 session.created 后处理
      // ============================================

      onPermissionAsked: (request, scope) => {
        if (!isActiveScope(scope)) return
        activeSessionStore.setSessionMeta(
          request.sessionID,
          undefined,
          scope.directory === 'global' ? undefined : scope.directory,
          scope.serverID,
          scope.workspace,
        )
        const meta = activeSessionStore.getSessionMeta(request.sessionID, scope.serverID)

        if (autoApproveStore.fullAutoMode === 'global') {
          const dir = meta?.directory
          if (autoApproveStore.claimAutoReply(request.id)) {
            replyPermission(request.id, 'once', undefined, dir, request.sessionID)
              .then(() => {
                if (!disposed) markPermissionReplied(request.sessionID, request.id)
              })
              .catch(() => {
                autoApproveStore.releaseAutoReply(request.id)
              })
          }
          return
        }

        const sessionLabel = meta?.title || request.sessionID.slice(0, 8)
        const desc = request.patterns?.length ? `${request.permission}: ${request.patterns[0]}` : request.permission

        activeSessionStore.addPendingRequest(request.id, request.sessionID, 'permission', desc)
        if (activeFetchVersion !== 0) {
          latePendingRequests.set(request.id, {
            requestId: request.id,
            sessionId: request.sessionID,
            type: 'permission',
            description: desc,
            scopeKey: getScopeKey(directoriesRef.current),
            directory: meta?.directory,
          })
        }

        const belongsToCurrent = belongsToCurrentSession(request.sessionID)
        if (!belongsToCurrent) {
          notificationStore.push('permission', `${sessionLabel} — Permission`, desc, request.sessionID, meta?.directory)
        } else if (isSessionDirectlyOpen(request.sessionID) && soundStore.getSnapshot().currentSessionEnabled) {
          playNotificationSoundDeduped('permission')
        }

        if (belongsToCurrent) {
          sendSystemNotification('permission', request.sessionID, 'Permission Required', desc, scope)
          dispatchToConsumers(request.sessionID, cb => cb.onPermissionAsked?.(request))
          return
        }
        addPending(pendingPermissions, request.sessionID, request)
      },

      onPermissionReplied: (data, scope) => {
        if (!isActiveScope(scope)) return
        markPermissionReplied(data.sessionID, data.requestID)
      },

      // ============================================
      // Question Events
      // ============================================

      onQuestionAsked: (request, scope) => {
        if (!isActiveScope(scope)) return
        activeSessionStore.setSessionMeta(
          request.sessionID,
          undefined,
          scope.directory === 'global' ? undefined : scope.directory,
          scope.serverID,
          scope.workspace,
        )
        const meta = activeSessionStore.getSessionMeta(request.sessionID, scope.serverID)
        const sessionLabel = meta?.title || request.sessionID.slice(0, 8)
        const desc = request.questions?.[0]?.header || 'AI is waiting for your input'

        activeSessionStore.addPendingRequest(request.id, request.sessionID, 'question', desc)
        if (activeFetchVersion !== 0) {
          latePendingRequests.set(request.id, {
            requestId: request.id,
            sessionId: request.sessionID,
            type: 'question',
            description: desc,
            scopeKey: getScopeKey(directoriesRef.current),
            directory: meta?.directory,
          })
        }

        const belongsToCurrent = belongsToCurrentSession(request.sessionID)
        if (!belongsToCurrent) {
          notificationStore.push('question', `${sessionLabel} — Question`, desc, request.sessionID, meta?.directory)
        } else if (isSessionDirectlyOpen(request.sessionID) && soundStore.getSnapshot().currentSessionEnabled) {
          playNotificationSoundDeduped('question')
        }

        if (belongsToCurrent) {
          sendSystemNotification('question', request.sessionID, 'Question', desc, scope)
          dispatchToConsumers(request.sessionID, cb => cb.onQuestionAsked?.(request))
          return
        }
        addPending(pendingQuestions, request.sessionID, request)
      },

      onQuestionReplied: (data, scope) => {
        if (!isActiveScope(scope)) return
        removePendingByRequestId(pendingQuestions, data.sessionID, data.requestID)
        latePendingRequests.delete(data.requestID)
        activeSessionStore.resolvePendingRequest(data.requestID)

        if (belongsToCurrentSession(data.sessionID)) {
          dispatchToConsumers(data.sessionID, cb => cb.onQuestionReplied?.(data))
        }
      },

      onQuestionRejected: (data, scope) => {
        if (!isActiveScope(scope)) return
        removePendingByRequestId(pendingQuestions, data.sessionID, data.requestID)
        latePendingRequests.delete(data.requestID)
        activeSessionStore.resolvePendingRequest(data.requestID)

        if (belongsToCurrentSession(data.sessionID)) {
          dispatchToConsumers(data.sessionID, cb => cb.onQuestionRejected?.(data))
        }
      },

      // ============================================
      // Session Status → activeSessionStore
      // ============================================

      onSessionStatus: (data, scope) => {
        if (!isActiveScope(scope)) return
        const prevStatus = activeSessionStore.getSnapshot().statusMap[data.sessionID]
        const wasBusy = prevStatus && (prevStatus.type === 'busy' || prevStatus.type === 'retry')

        activeSessionStore.updateStatus(data.sessionID, data.status)

        if (wasBusy && data.status.type === 'idle' && !belongsToCurrentSession(data.sessionID)) {
          const meta = activeSessionStore.getSessionMeta(data.sessionID, scope.serverID)
          const sessionLabel = meta?.title || data.sessionID.slice(0, 8)
          notificationStore.push(
            'completed',
            sessionLabel,
            'Session completed',
            data.sessionID,
            meta?.directory ?? (scope.directory === 'global' ? undefined : scope.directory),
          )
        } else if (
          wasBusy &&
          data.status.type === 'idle' &&
          isSessionDirectlyOpen(data.sessionID) &&
          soundStore.getSnapshot().currentSessionEnabled
        ) {
          playNotificationSoundDeduped('completed')
        }
      },

      onFileEdited: (data, scope) => {
        if (!isActiveScope(scope)) return
        invalidateRootCaches(scope)
        runtimeInvalidationStore.emit({ type: 'file', scope, file: data.file, event: 'edited' })
      },

      onFileWatcherUpdated: (data, scope) => {
        if (!isActiveScope(scope)) return
        invalidateRootCaches(scope)
        runtimeInvalidationStore.emit({ type: 'file', scope, file: data.file, event: data.event })
      },

      onLspUpdated: (_data, scope) => {
        if (!isActiveScope(scope)) return
        runtimeInvalidationStore.emit({ type: 'lsp', scope })
      },

      onServerInstanceDisposed: (data, scope) => {
        // LRU 驱逐降级为 stale 标记（W2④）：只写入休眠目录表 + 本地清理，
        // 不 resyncRuntime、不广播、不触发任何自动重拉（0 请求）；
        // 用户再次切回该目录（进入 pinned）时才清除标记并惰性重拉。
        // 旧版本服务器不携带 reason，按 LRU 处理以获得同样的风暴保护。
        // reload / 显式 dispose 意味着服务端数据可能变化，保持原有全量 resync。
        const reason = (data as { reason?: string }).reason
        const directoryScope = { ...scope, directory: data.directory }
        if (!reason || LRU_DISPOSE_REASONS.has(reason)) {
          serverDisposedDirectoryStore.markDisposed(scope.serverID, data.directory)
          if (isActiveScope(directoryScope)) clearDisposedScopeState(directoryScope)
          return
        }
        disposeRuntimeScope(directoryScope)
      },

      onGlobalDisposed: (_data, scope) => {
        disposeRuntimeScope({ ...scope, directory: 'global', workspace: undefined })
      },

      onEventGap: (data, scope) => {
        if (import.meta.env.DEV) {
          console.warn(`[GlobalEvents] Event gap detected (${data.dropped} dropped), resyncing`)
        }
        resyncRuntime(scope, 'event-gap')
      },

      onReconnected: (reason, serverID) => {
        if (import.meta.env.DEV) {
          console.log(`[GlobalEvents] SSE reconnected (reason: ${reason}), resyncing`)
        }
        resyncRuntime({ serverID, directory: 'global' }, reason)
      },
    })

    fetchAndInitialize()
    refreshActiveServerHealth()
    approveGlobalPendingPermissions()

    return () => {
      disposed = true
      if (disposeResyncTimer) clearTimeout(disposeResyncTimer)
      if (refreshRef.current === fetchAndInitialize) {
        refreshRef.current = null
      }
      unsubscribeAutoApprove()
      unsubscribeServerChange()
      unsubscribe()
    }
  }, [sendNotification])

  useLayoutEffect(() => {
    directoriesRef.current = directories
    pinnedDirectoriesRef.current = options?.pinnedDirectories
    // 用户显式切入的目录视为真实需求：清除休眠标记，允许重新拉取/boot
    const serverID = serverStore.getActiveServerId()
    for (const directory of options?.pinnedDirectories ?? []) {
      serverDisposedDirectoryStore.clear(serverID, directory)
    }
    // 内容比较：目录集合（含 pinned）没变就不触发刷新，
    // 消除数组引用变化引发的 3×N background 请求突发（W2②）
    const scopeKey = `${activeDirectoriesKey(directories)}#${activeDirectoriesKey(options?.pinnedDirectories)}`
    if (initializedDirectoriesRef.current) {
      if (scopeKey === lastScopeKeyRef.current) return
      lastScopeKeyRef.current = scopeKey
      refreshRef.current?.('merge')
      return
    }
    lastScopeKeyRef.current = scopeKey
    initializedDirectoriesRef.current = true
  }, [directories, options?.pinnedDirectories])
}

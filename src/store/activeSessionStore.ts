// ============================================
// ActiveSessionStore - 追踪所有 session 的活跃状态
// ============================================
//
// 职责单一：只管 session 是否活跃、在等什么
//
// 数据来源：
// 1. GET /session/status → 全量 session 状态
// 2. GET /permission + GET /question → 补充等待中的 session
// 3. SSE session.status / permission.asked / question.asked 事件
//
// 与 notificationStore 完全独立，不互相依赖

import { useCallback, useSyncExternalStore } from 'react'
import type { SessionStatus, SessionStatusMap } from '../types/api/session'
import { serverStore } from './serverStore'
import { childSessionStore } from './childSessionStore'

// ============================================
// Types
// ============================================

export interface PendingRequest {
  requestId: string
  sessionId: string
  type: 'permission' | 'question'
  description?: string
}

export interface ActiveSessionEntry {
  sessionId: string
  status: SessionStatus
  title?: string
  directory?: string
  serverID?: string
  workspaceID?: string
  /** session 当前等待的用户操作 */
  pendingAction?: {
    type: 'permission' | 'question'
    description?: string
  }
  /** 合成的祖先条目专用：自身 idle 但存在 running 的后代子会话（后台工作中） */
  backgroundBusy?: boolean
  /** 待查看留存 entry 专用：busy→idle 后用户是否已点开查看（isSame 比较忽略此字段） */
  retainedViewed?: boolean
}

export interface SessionMetaEntry {
  sessionId: string
  title?: string
  directory?: string
  serverID?: string
  workspaceID?: string
}

interface ActiveSessionState {
  statusMap: SessionStatusMap
  initialized: boolean
}

type SessionMeta = Omit<SessionMetaEntry, 'sessionId' | 'serverID'> & { serverID: string }
type Subscriber = () => void

function isSameBusySessions(a: ActiveSessionEntry[], b: ActiveSessionEntry[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]
    const right = b[i]
    if (left.sessionId !== right.sessionId) return false
    if (left.title !== right.title || left.directory !== right.directory) return false
    if (left.serverID !== right.serverID || left.workspaceID !== right.workspaceID) return false
    if (left.pendingAction?.type !== right.pendingAction?.type) return false
    if (left.pendingAction?.description !== right.pendingAction?.description) return false
    if (left.status.type !== right.status.type) return false
    if (left.backgroundBusy !== right.backgroundBusy) return false
    if (left.status.type === 'retry' && right.status.type === 'retry') {
      if (
        left.status.attempt !== right.status.attempt ||
        left.status.message !== right.status.message ||
        left.status.next !== right.status.next
      ) {
        return false
      }
    }
  }
  return true
}

// ============================================
// Store
// ============================================

class ActiveSessionStore {
  private state: ActiveSessionState = {
    statusMap: {},
    initialized: false,
  }
  private subscribers = new Set<Subscriber>()

  // session 元信息缓存（sessionID → serverID → metadata）
  private sessionMeta = new Map<string, Map<string, SessionMeta>>()

  // 未回复的 permission/question 请求 — requestId → PendingRequest
  private pendingRequests = new Map<string, PendingRequest>()

  // 服务端已报告 idle，但因有未回复请求而暂缓移出的 session
  private deferredIdleSessions = new Set<string>()

  // 待查看留存：本次客户端观察到 busy→idle 的 session，留在活跃区直到用户点开并离开（纯内存，不持久化）
  private retained = new Map<string, { viewed: boolean }>()

  // busy→idle 时仍有 running 后代子会话的 session：暂缓进入留存，等最后一个后代 idle 后补入
  private waitRetain = new Set<string>()

  // 派生数据缓存
  private cachedBusySessions: ActiveSessionEntry[] = []
  private cachedBusyCount: number = 0
  private cachedRetainedSessions: ActiveSessionEntry[] = []

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify() {
    this.recomputeDerived()
    this.subscribers.forEach(cb => {
      cb()
    })
  }

  private recomputeDerived() {
    const activeServerID = serverStore.getActiveServerId()
    const entries = Object.entries(this.state.statusMap)
      .filter(([, status]) => status.type === 'busy' || status.type === 'retry')
      .map(([sessionId, status]) => {
        const meta = this.sessionMeta.get(sessionId)?.get(activeServerID)
        // 从自身 pendingRequests 查 pending action
        const pending = this.findPendingForSession(sessionId)
        return {
          sessionId,
          status,
          title: meta?.title,
          directory: meta?.directory,
          serverID: meta?.serverID,
          workspaceID: meta?.workspaceID,
          pendingAction: pending ? { type: pending.type, description: pending.description } : undefined,
        } as ActiveSessionEntry
      })

    // waitRetain 收口：最后一个 running 后代 idle 后，把暂缓的 session 补入待查看留存
    for (const sessionId of [...this.waitRetain]) {
      if (this.state.statusMap[sessionId] || this.hasRunningDescendants(sessionId)) continue
      this.waitRetain.delete(sessionId)
      this.captureRetained(sessionId)
    }

    const metaOf = (sessionId: string) => this.sessionMeta.get(sessionId)?.get(activeServerID)
    const included = new Set(entries.map(entry => entry.sessionId))

    // running 子会话补录：childSessionStore 标记 running 但 statusMap 缺失（子会话 status 事件缺失的防御）
    for (const info of childSessionStore.getChildSessionsByStatus('running')) {
      if (included.has(info.id)) continue
      included.add(info.id)
      // 门判定它活跃 → 任何留存都是陈旧的，一并清除（防止同一子会话同时占「工作中」+「待查看」两行）
      this.retained.delete(info.id)
      this.waitRetain.delete(info.id)
      const meta = metaOf(info.id)
      entries.push({
        sessionId: info.id,
        status: { type: 'busy' },
        title: meta?.title ?? info.title,
        directory: meta?.directory,
        serverID: meta?.serverID,
        workspaceID: meta?.workspaceID,
        pendingAction: undefined,
      } as ActiveSessionEntry)
    }

    // 祖先合成：活跃会话的 idle 祖先仍在等待后台后代，合成 backgroundBusy 条目留在活跃区
    for (const sessionId of [...included]) {
      let parentId = childSessionStore.getSessionInfo(sessionId)?.parentID
      while (parentId && !included.has(parentId)) {
        if (this.state.statusMap[parentId] || this.retained.has(parentId)) break
        included.add(parentId)
        const meta = metaOf(parentId)
        entries.push({
          sessionId: parentId,
          status: { type: 'idle' },
          title: meta?.title,
          directory: meta?.directory,
          serverID: meta?.serverID,
          workspaceID: meta?.workspaceID,
          pendingAction: undefined,
          backgroundBusy: true,
        } as ActiveSessionEntry)
        parentId = childSessionStore.getSessionInfo(parentId)?.parentID
      }
    }

    // 内容不变时复用旧数组引用，避免 useBusySessions 订阅方因引用抖动重渲染
    if (!isSameBusySessions(this.cachedBusySessions, entries)) {
      this.cachedBusySessions = entries
    }
    this.cachedBusyCount = entries.length

    // 待查看留存 entry：已回到 statusMap / 已在 busy 集合（running 补录、祖先合成）的 session 不再出现在留存列表；
    // 留存语义只服务根会话——修复前存量进入 retained 的子会话同样不渲染（不进渲染即视觉消失，map 残留由后续事件自然清理）
    const retainedEntries = [...this.retained.keys()]
      .filter(
        sessionId =>
          !this.state.statusMap[sessionId] && !included.has(sessionId) && !childSessionStore.getSessionInfo(sessionId),
      )
      .map(sessionId => {
        const meta = this.sessionMeta.get(sessionId)?.get(activeServerID)
        return {
          sessionId,
          status: { type: 'idle' },
          title: meta?.title,
          directory: meta?.directory,
          serverID: meta?.serverID,
          workspaceID: meta?.workspaceID,
          pendingAction: undefined,
          retainedViewed: this.retained.get(sessionId)?.viewed,
        } as ActiveSessionEntry
      })
    if (!isSameBusySessions(this.cachedRetainedSessions, retainedEntries)) {
      this.cachedRetainedSessions = retainedEntries
    }
  }

  private findPendingForSession(sessionId: string): PendingRequest | undefined {
    for (const req of this.pendingRequests.values()) {
      if (req.sessionId === sessionId) return req
    }
    return undefined
  }

  hasPendingForSession(sessionId: string): boolean {
    for (const req of this.pendingRequests.values()) {
      if (req.sessionId === sessionId) return true
    }
    return false
  }

  getSnapshot = (): ActiveSessionState => this.state
  getBusySessionsSnapshot = (): ActiveSessionEntry[] => this.cachedBusySessions
  getBusyCountSnapshot = (): number => this.cachedBusyCount
  getRetainedSessionsSnapshot = (): ActiveSessionEntry[] => this.cachedRetainedSessions

  // busy→idle 转换捕获：只有转换前在 statusMap 中（本次客户端观察到过活跃）的 session 才进入留存；
  // 仍有 running 后代子会话时暂缓（waitRetain），由 recomputeDerived 在后代全部 idle 后补入
  private captureRetained(sessionId: string) {
    // 留存语义只服务根会话：子会话 busy→idle 直接从活跃区消失，不进「待查看」留存（用户不会点开子会话消费留存）
    if (childSessionStore.getSessionInfo(sessionId)) {
      this.retained.delete(sessionId)
      this.waitRetain.delete(sessionId)
      return
    }
    if (this.hasRunningDescendants(sessionId)) {
      this.retained.delete(sessionId)
      this.waitRetain.add(sessionId)
      return
    }
    this.waitRetain.delete(sessionId)
    if (!this.retained.has(sessionId)) this.retained.set(sessionId, { viewed: false })
  }

  /** 递归检查是否存在 status==='running' 的后代子会话（'idle'/'error' 不算） */
  private hasRunningDescendants(sessionId: string): boolean {
    return childSessionStore.getChildSessionIds(sessionId).some(childId => {
      if (childSessionStore.getSessionInfo(childId)?.status === 'running') return true
      return this.hasRunningDescendants(childId)
    })
  }

  /** childSessionStore 关系/状态变化后的对账入口：重算派生快照并通知订阅方 */
  reconcileChildSessions() {
    this.notify()
  }

  /** 标记留存 session 已被用户点开；不触发渲染，effect 直接从快照 entry 对象读 retainedViewed */
  markRetainedViewed(sessionId: string) {
    const retained = this.retained.get(sessionId)
    if (!retained || retained.viewed) return
    retained.viewed = true
    const cached = this.cachedRetainedSessions.find(entry => entry.sessionId === sessionId)
    if (cached) cached.retainedViewed = true
  }

  /** 用户离开已查看的留存 session → 移出活跃区，回归最近列表 */
  releaseRetained(sessionId: string) {
    if (!this.retained.delete(sessionId)) return
    this.notify()
  }

  private applyStatusSnapshot(statusMap: SessionStatusMap, baseMap: SessionStatusMap): SessionStatusMap {
    const nextMap = { ...baseMap }

    for (const [sessionId, status] of Object.entries(statusMap)) {
      if (status.type === 'idle') {
        if (baseMap[sessionId]) this.captureRetained(sessionId)
        delete nextMap[sessionId]
        continue
      }

      this.retained.delete(sessionId)
      this.waitRetain.delete(sessionId)
      nextMap[sessionId] = status.type === 'retry' ? { ...status } : { type: 'busy' }
    }

    return nextMap
  }

  // ============================================
  // 初始化：从 API 拉取全量状态
  // ============================================

  initialize(statusMap: SessionStatusMap) {
    this.state = {
      statusMap: this.applyStatusSnapshot(statusMap, {}),
      initialized: true,
    }
    // 全量快照对账：历史恢复/事件缺失导致的 stale running 子会话，缺席=服务端认定 idle
    for (const info of childSessionStore.getChildSessionsByStatus('running')) {
      if (!this.state.statusMap[info.id] && !this.hasPendingForSession(info.id)) {
        childSessionStore.markIdle(info.id)
      }
    }
    this.notify()
  }

  // ============================================
  // 范围刷新：返回值不是全量状态，只更新这次明确返回的 session
  // ============================================

  mergeStatusRefresh(statusMap: SessionStatusMap) {
    this.state = {
      statusMap: this.applyStatusSnapshot(statusMap, this.state.statusMap),
      initialized: true,
    }
    this.notify()
  }

  // ============================================
  // 初始化：从 /permission + /question API 补充
  // ============================================

  initializePendingRequests(
    permissions: Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>,
    questions: Array<{ id: string; sessionID: string; questions?: Array<{ header?: string }> }>,
  ) {
    this.applyPendingSnapshot(permissions, questions, new Map<string, PendingRequest>(), new Set<string>())
  }

  // ============================================
  // 范围刷新：保留这次范围外已知的 pending request
  // ============================================

  mergePendingRequests(
    permissions: Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>,
    questions: Array<{ id: string; sessionID: string; questions?: Array<{ header?: string }> }>,
  ) {
    this.applyPendingSnapshot(permissions, questions, new Map(this.pendingRequests), new Set(this.deferredIdleSessions))
  }

  private applyPendingSnapshot(
    permissions: Array<{ id: string; sessionID: string; permission: string; patterns?: string[] }>,
    questions: Array<{ id: string; sessionID: string; questions?: Array<{ header?: string }> }>,
    pendingRequests: Map<string, PendingRequest>,
    deferredIdleSessions: Set<string>,
  ) {
    let changed = false
    const newMap = { ...this.state.statusMap }

    for (const p of permissions) {
      const desc = p.patterns?.length ? `${p.permission}: ${p.patterns[0]}` : p.permission
      pendingRequests.set(p.id, {
        requestId: p.id,
        sessionId: p.sessionID,
        type: 'permission',
        description: desc,
      })
      if (!newMap[p.sessionID] || newMap[p.sessionID].type === 'idle') {
        newMap[p.sessionID] = { type: 'busy' }
        deferredIdleSessions.add(p.sessionID)
        this.retained.delete(p.sessionID)
        this.waitRetain.delete(p.sessionID)
        changed = true
      }
    }

    for (const q of questions) {
      const desc = q.questions?.[0]?.header || 'Waiting for input'
      pendingRequests.set(q.id, {
        requestId: q.id,
        sessionId: q.sessionID,
        type: 'question',
        description: desc,
      })
      if (!newMap[q.sessionID] || newMap[q.sessionID].type === 'idle') {
        newMap[q.sessionID] = { type: 'busy' }
        deferredIdleSessions.add(q.sessionID)
        this.retained.delete(q.sessionID)
        this.waitRetain.delete(q.sessionID)
        changed = true
      }
    }

    this.pendingRequests = pendingRequests
    this.deferredIdleSessions = deferredIdleSessions

    if (changed) {
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：permission/question asked → 注册 pending
  // ============================================

  addPendingRequest(requestId: string, sessionId: string, type: 'permission' | 'question', description?: string) {
    this.pendingRequests.set(requestId, { requestId, sessionId, type, description })
    // 留存中的 session 收到 pending request → 清除留存，恢复 busy 显示
    this.retained.delete(sessionId)
    this.waitRetain.delete(sessionId)
    // 确保 session 在 busy 列表
    if (!this.state.statusMap[sessionId] || this.state.statusMap[sessionId].type === 'idle') {
      const newMap = { ...this.state.statusMap, [sessionId]: { type: 'busy' as const } }
      this.deferredIdleSessions.add(sessionId)
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：permission/question replied → 移除 pending
  // ============================================

  resolvePendingRequest(requestId: string) {
    const req = this.pendingRequests.get(requestId)
    if (!req) return
    this.pendingRequests.delete(requestId)

    // 检查该 session 是否还有其他 pending，没有且 deferred 就移出 busy
    if (this.deferredIdleSessions.has(req.sessionId) && !this.hasPendingForSession(req.sessionId)) {
      this.deferredIdleSessions.delete(req.sessionId)
      const newMap = { ...this.state.statusMap }
      delete newMap[req.sessionId]
      this.captureRetained(req.sessionId)
      this.state = { ...this.state, statusMap: newMap }
    }
    this.notify()
  }

  // ============================================
  // SSE 事件：session status 更新
  // ============================================

  updateStatus(sessionId: string, status: SessionStatus) {
    const newMap = { ...this.state.statusMap }

    if (status.type === 'idle') {
      if (this.hasPendingForSession(sessionId)) {
        this.deferredIdleSessions.add(sessionId)
      } else {
        this.deferredIdleSessions.delete(sessionId)
        if (this.state.statusMap[sessionId]) this.captureRetained(sessionId)
        delete newMap[sessionId]
      }
    } else if (status.type === 'retry') {
      this.deferredIdleSessions.delete(sessionId)
      this.retained.delete(sessionId)
      this.waitRetain.delete(sessionId)
      newMap[sessionId] = { ...status }
    } else {
      this.deferredIdleSessions.delete(sessionId)
      this.retained.delete(sessionId)
      this.waitRetain.delete(sessionId)
      newMap[sessionId] = { type: 'busy' }
    }

    this.state = { ...this.state, statusMap: newMap }
    this.notify()
  }

  removeSession(sessionId: string, serverID = serverStore.getActiveServerId()) {
    let changed = false
    let nextMap = this.state.statusMap

    if (nextMap[sessionId]) {
      nextMap = { ...nextMap }
      delete nextMap[sessionId]
      changed = true
    }

    for (const [requestId, request] of this.pendingRequests) {
      if (request.sessionId !== sessionId) continue
      this.pendingRequests.delete(requestId)
      changed = true
    }

    if (this.deferredIdleSessions.delete(sessionId)) changed = true
    if (this.retained.delete(sessionId)) changed = true
    if (this.waitRetain.delete(sessionId)) changed = true
    const metadataByServer = this.sessionMeta.get(sessionId)
    if (metadataByServer?.delete(serverID)) {
      if (metadataByServer.size === 0) this.sessionMeta.delete(sessionId)
      changed = true
    }

    if (!changed) return
    this.state = { ...this.state, statusMap: nextMap }
    this.notify()
  }

  resetRuntimeState() {
    this.state = { statusMap: {}, initialized: false }
    this.pendingRequests.clear()
    this.deferredIdleSessions.clear()
    this.retained.clear()
    this.waitRetain.clear()
    this.notify()
  }

  // ============================================
  // Session 元信息管理
  // ============================================

  setSessionMeta(sessionId: string, title?: string, directory?: string, serverID?: string, workspaceID?: string) {
    const scopedServerID = serverID ?? serverStore.getActiveServerId()
    const metadataByServer = this.sessionMeta.get(sessionId) ?? new Map<string, SessionMeta>()
    const existing = metadataByServer.get(scopedServerID)
    const replaceScope = serverID !== undefined
    const next = {
      title: title ?? existing?.title,
      directory: replaceScope ? directory : (directory ?? existing?.directory),
      serverID: scopedServerID,
      workspaceID: replaceScope ? workspaceID : (workspaceID ?? existing?.workspaceID),
    }
    if (
      next.title !== existing?.title ||
      next.directory !== existing?.directory ||
      next.serverID !== existing?.serverID ||
      next.workspaceID !== existing?.workspaceID
    ) {
      metadataByServer.set(scopedServerID, next)
      this.sessionMeta.set(sessionId, metadataByServer)
      this.notify()
    }
  }

  setSessionMetaBulk(entries: SessionMetaEntry[]) {
    let changed = false

    for (const entry of entries) {
      const scopedServerID = entry.serverID ?? serverStore.getActiveServerId()
      const metadataByServer = this.sessionMeta.get(entry.sessionId) ?? new Map<string, SessionMeta>()
      const existing = metadataByServer.get(scopedServerID)
      const replaceScope = entry.serverID !== undefined
      const next = {
        title: entry.title ?? existing?.title,
        directory: replaceScope ? entry.directory : (entry.directory ?? existing?.directory),
        serverID: scopedServerID,
        workspaceID: replaceScope ? entry.workspaceID : (entry.workspaceID ?? existing?.workspaceID),
      }

      if (
        next.title !== existing?.title ||
        next.directory !== existing?.directory ||
        next.serverID !== existing?.serverID ||
        next.workspaceID !== existing?.workspaceID
      ) {
        metadataByServer.set(scopedServerID, next)
        this.sessionMeta.set(entry.sessionId, metadataByServer)
        changed = true
      }
    }

    if (changed) {
      this.notify()
    }
  }

  getSessionMeta(sessionId: string, serverID?: string) {
    const metadataByServer = this.sessionMeta.get(sessionId)
    if (!metadataByServer) return undefined
    if (serverID) return metadataByServer.get(serverID)
    if (metadataByServer.size === 1) return metadataByServer.values().next().value
    return undefined
  }

  getSessionMetaServerIDs(sessionId: string): string[] {
    return [...(this.sessionMeta.get(sessionId)?.keys() ?? [])]
  }

  getSessionIdsForScope(scope: { serverID: string; directory?: string; workspace?: string }): string[] {
    const sessionIds: string[] = []

    for (const [sessionId, metadataByServer] of this.sessionMeta) {
      const meta = metadataByServer.get(scope.serverID)
      if (!meta) continue
      if (scope.workspace && meta.workspaceID !== scope.workspace) continue
      if (!scope.workspace && scope.directory && meta.directory !== scope.directory) continue
      sessionIds.push(sessionId)
    }

    return sessionIds
  }

  getBusySessions(): ActiveSessionEntry[] {
    return this.cachedBusySessions
  }

  get busyCount(): number {
    return this.cachedBusyCount
  }
}

// ============================================
// Singleton & React Hooks
// ============================================

export const activeSessionStore = new ActiveSessionStore()

export function useActiveSessionStore() {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getSnapshot)
}

export function useBusySessions(): ActiveSessionEntry[] {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getBusySessionsSnapshot)
}

export function useRetainedSessions(): ActiveSessionEntry[] {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getRetainedSessionsSnapshot)
}

export function useBusyCount(): number {
  return useSyncExternalStore(activeSessionStore.subscribe, activeSessionStore.getBusyCountSnapshot)
}

/** 按 sessionId 查活跃状态，不活跃时返回 undefined */
export function useSessionActiveEntry(sessionId: string): ActiveSessionEntry | undefined {
  const getSnapshot = useCallback(
    () => activeSessionStore.getBusySessions().find(e => e.sessionId === sessionId),
    [sessionId],
  )
  return useSyncExternalStore(activeSessionStore.subscribe, getSnapshot)
}

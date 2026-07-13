// ============================================
// Server Store - 多后端服务器配置管理
// ============================================

import { API_BASE_URL } from '../constants'
import { checkCandidateServerHealth } from '../api/health'
import { isTauriAndroid } from '../utils/tauri'
export { makeBasicAuthHeader } from '../api/health'

/**
 * 服务器认证信息
 */
export interface ServerAuth {
  username: string // 用户名 (默认 opencode)
  password: string // 密码
}

/**
 * 服务器配置
 */
export interface ServerConfig {
  id: string // 唯一标识
  name: string // 显示名称
  url: string // 服务器 URL (不含尾部斜杠)
  isDefault?: boolean // 是否为默认服务器
  auth?: ServerAuth // 认证信息 (可选)
}

/**
 * 服务器健康状态
 */
export interface ServerHealth {
  status: 'checking' | 'online' | 'offline' | 'error' | 'unauthorized'
  latency?: number // 响应延迟 (ms)
  lastCheck?: number // 上次检查时间戳
  error?: string // 错误信息
  details?: string // 原始诊断信息
  version?: string // 服务器版本
}

export interface ServerSettingsBackup {
  servers: ServerConfig[]
  activeServerId: string | null
}

interface ServerClockCalibration {
  serverTimestamp: number
  calibratedAtMonotonic: number
}

type Listener = () => void
export type ServerChangeReason = 'server-switch' | 'local-runtime-url'

const STORAGE_KEY = 'opencode-servers'
const ACTIVE_SERVER_KEY = 'opencode-active-server'
export const LOCAL_SERVER_ID = 'local'

/**
 * Server Store
 * 管理多个 OpenCode 后端服务器配置
 */
class ServerStore {
  private servers: ServerConfig[] = []
  private activeServerId: string | null = null
  private healthMap = new Map<string, ServerHealth>()
  private healthCheckSeqMap = new Map<string, number>()
  private clockCalibrationMap = new Map<string, ServerClockCalibration>()
  private listeners: Set<Listener> = new Set()
  private localServerUrlOverride: string | null = null

  // server 切换监听器（用于触发 SSE 重连等副作用，避免循环依赖）
  private serverChangeListeners: Set<(newServerId: string, reason: ServerChangeReason) => void> = new Set()

  // 快照缓存 (用于 useSyncExternalStore)
  private _serversSnapshot: ServerConfig[] = []
  private _activeServerSnapshot: ServerConfig | null = null
  private _healthMapSnapshot: Map<string, ServerHealth> = new Map()

  // 默认本地服务器 ID
  private readonly DEFAULT_SERVER_ID = LOCAL_SERVER_ID

  constructor() {
    this.loadFromStorage()
    this.updateSnapshots()
  }

  // ============================================
  // Storage
  // ============================================

  private loadFromStorage(): void {
    const allowLocalServer = !isTauriAndroid()

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        this.servers = JSON.parse(stored)
      }

      if (!allowLocalServer) {
        this.servers = this.servers.filter(server => server.id !== this.DEFAULT_SERVER_ID)
      }

      if (this.servers.length === 0 && allowLocalServer) {
        this.servers = [
          {
            id: this.DEFAULT_SERVER_ID,
            name: 'Local',
            url: API_BASE_URL,
            isDefault: true,
          },
        ]
      }

      const activeId = sessionStorage.getItem(ACTIVE_SERVER_KEY) ?? localStorage.getItem(ACTIVE_SERVER_KEY)
      if (activeId && this.servers.some(s => s.id === activeId)) {
        this.activeServerId = activeId
        return
      }

      this.activeServerId = this.servers[0]?.id ?? null
    } catch {
      this.servers = allowLocalServer
        ? [
            {
              id: this.DEFAULT_SERVER_ID,
              name: 'Local',
              url: API_BASE_URL,
              isDefault: true,
            },
          ]
        : []
      this.activeServerId = allowLocalServer ? this.DEFAULT_SERVER_ID : null
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.servers))
      if (this.activeServerId) {
        // 写入 sessionStorage（当前窗口刷新保持）+ localStorage（新窗口默认值）
        sessionStorage.setItem(ACTIVE_SERVER_KEY, this.activeServerId)
        localStorage.setItem(ACTIVE_SERVER_KEY, this.activeServerId)
      }
    } catch {
      // ignore
    }
  }

  // ============================================
  // Subscription
  // ============================================

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 注册 active server 入口变化监听器（server id 切换或 active local runtime URL 变化）。
   * 返回取消注册函数。
   */
  onServerChange(fn: (newServerId: string, reason: ServerChangeReason) => void): () => void {
    this.serverChangeListeners.add(fn)
    return () => this.serverChangeListeners.delete(fn)
  }

  private notifyServerChange(serverId: string, reason: ServerChangeReason): void {
    this.serverChangeListeners.forEach(fn => {
      fn(serverId, reason)
    })
  }

  private notify(): void {
    this.updateSnapshots()
    this.listeners.forEach(l => {
      l()
    })
  }

  /**
   * 更新快照缓存
   */
  private updateSnapshots(): void {
    this._serversSnapshot = this.servers.map(server => this.withRuntimeServerUrl(server))
    this._activeServerSnapshot = this._serversSnapshot.find(s => s.id === this.activeServerId) ?? null
    this._healthMapSnapshot = new Map(this.healthMap)
  }

  private withRuntimeServerUrl(server: ServerConfig): ServerConfig {
    if (server.id === this.DEFAULT_SERVER_ID && this.localServerUrlOverride) {
      return { ...server, url: this.localServerUrlOverride }
    }
    return server
  }

  // ============================================
  // Getters
  // ============================================

  /**
   * 获取所有服务器配置 (返回缓存快照)
   */
  getServers(): ServerConfig[] {
    return this._serversSnapshot
  }

  getServer(serverId: string): ServerConfig | null {
    return this._serversSnapshot.find(server => server.id === serverId) ?? null
  }

  getStoredServers(): ServerConfig[] {
    return [...this.servers]
  }

  /**
   * 获取当前活动服务器 (返回缓存快照)
   */
  getActiveServer(): ServerConfig | null {
    return this._activeServerSnapshot
  }

  hasActiveServer(): boolean {
    return this._activeServerSnapshot !== null
  }

  getLocalServer(): ServerConfig | null {
    return this._serversSnapshot.find(s => s.id === this.DEFAULT_SERVER_ID) ?? null
  }

  getLocalServerUrl(): string {
    return this.getLocalServer()?.url ?? API_BASE_URL
  }

  isActiveLocalServer(): boolean {
    return this.getActiveServerId() === this.DEFAULT_SERVER_ID
  }

  /**
   * 获取当前活动服务器 ID（用于 per-server storage 等场景）
   * 返回 'local' 作为默认值，保证永远有值
   */
  getActiveServerId(): string {
    return this.activeServerId ?? this.DEFAULT_SERVER_ID
  }

  /**
   * 获取当前 API Base URL
   */
  getActiveBaseUrl(): string {
    return this.getServerBaseUrl(this.getActiveServerId())
  }

  getServerBaseUrl(serverId: string): string {
    const server = this.getServer(serverId)
    if (!server) throw new Error(`Unknown server: ${serverId}`)
    return server.url
  }

  /**
   * 获取当前活动服务器的认证信息
   */
  getActiveAuth(): ServerAuth | null {
    return this.getServerAuth(this.getActiveServerId())
  }

  /**
   * 获取指定服务器的认证信息
   */
  getServerAuth(serverId: string): ServerAuth | null {
    return this.getServer(serverId)?.auth ?? null
  }

  /**
   * 获取服务器健康状态
   */
  getHealth(serverId: string): ServerHealth | null {
    return this.healthMap.get(serverId) ?? null
  }

  /**
   * 获取所有服务器的健康状态 (返回缓存快照)
   */
  getAllHealth(): Map<string, ServerHealth> {
    return this._healthMapSnapshot
  }

  getActiveCalibratedNow(): number | undefined {
    const calibration = this.clockCalibrationMap.get(this.getActiveServerId())
    if (!calibration) return undefined
    return calibration.serverTimestamp + (performance.now() - calibration.calibratedAtMonotonic)
  }

  // ============================================
  // Mutations
  // ============================================

  /**
   * 添加服务器
   */
  addServer(config: Omit<ServerConfig, 'id'>): ServerConfig {
    const id = `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const server: ServerConfig = {
      ...config,
      id,
      url: config.url.replace(/\/+$/, ''), // 移除尾部斜杠
    }
    this.servers.push(server)
    this.saveToStorage()
    this.notify()
    return server
  }

  /**
   * 更新服务器配置
   */
  updateServer(id: string, updates: Partial<Omit<ServerConfig, 'id'>>): boolean {
    const index = this.servers.findIndex(s => s.id === id)
    if (index === -1) return false

    const server = this.servers[index]
    this.servers[index] = {
      ...server,
      ...updates,
      id: server.id, // 确保 id 不被覆盖
      url: updates.url ? updates.url.replace(/\/+$/, '') : server.url,
    }
    if (id === this.DEFAULT_SERVER_ID && updates.url) {
      this.localServerUrlOverride = null
    }
    this.saveToStorage()
    this.notify()
    return true
  }

  setLocalServerRuntimeUrl(url: string): boolean {
    if (!this.servers.some(s => s.id === this.DEFAULT_SERVER_ID)) return false

    const normalizedUrl = url.replace(/\/+$/, '')
    if (this.localServerUrlOverride === normalizedUrl) return false

    this.localServerUrlOverride = normalizedUrl
    this.notify()
    if (this.isActiveLocalServer()) {
      this.notifyServerChange(this.DEFAULT_SERVER_ID, 'local-runtime-url')
    }
    return true
  }

  /**
   * 删除服务器
   */
  removeServer(id: string): boolean {
    // 不能删除默认服务器
    const server = this.servers.find(s => s.id === id)
    if (!server || server.isDefault) return false
    const wasActive = this.activeServerId === id

    this.servers = this.servers.filter(s => s.id !== id)
    this.healthMap.delete(id)
    this.healthCheckSeqMap.delete(id)
    this.clockCalibrationMap.delete(id)

    if (wasActive) {
      this.activeServerId = this.servers[0]?.id ?? null
    }

    this.saveToStorage()
    this.notify()
    if (wasActive && this.activeServerId) {
      this.notifyServerChange(this.activeServerId, 'server-switch')
    }
    return true
  }

  /**
   * 设置活动服务器
   * 如果实际切换了服务器，会通知 serverChangeListeners（用于 SSE 重连等）
   */
  setActiveServer(id: string): boolean {
    if (!this.servers.some(s => s.id === id)) return false

    const changed = this.activeServerId !== id
    this.activeServerId = id
    this.saveToStorage()
    this.notify()

    if (changed) {
      this.notifyServerChange(id, 'server-switch')
    }

    return true
  }

  applyServerConnectedTimestamp(serverId: string, timestamp: unknown): boolean {
    const normalizedTimestamp = normalizeServerTimestamp(timestamp)
    if (normalizedTimestamp == null) return false

    this.clockCalibrationMap.set(serverId, {
      serverTimestamp: normalizedTimestamp,
      calibratedAtMonotonic: performance.now(),
    })
    this.notify()
    return true
  }

  // ============================================
  // Health Check
  // ============================================

  /**
   * 检查服务器健康状态
   */
  async checkHealth(serverId: string): Promise<ServerHealth> {
    const storedServer = this.servers.find(s => s.id === serverId)
    if (!storedServer) {
      return { status: 'error', error: 'Server not found' }
    }
    const server = this.withRuntimeServerUrl(storedServer)
    const checkSeq = (this.healthCheckSeqMap.get(serverId) ?? 0) + 1
    this.healthCheckSeqMap.set(serverId, checkSeq)

    const commitHealth = (health: ServerHealth) => {
      if (this.healthCheckSeqMap.get(serverId) === checkSeq) {
        this.healthMap.set(serverId, health)
        this.notify()
      }
      return health
    }

    // 标记为检查中
    this.healthMap.set(serverId, { status: 'checking' })
    this.notify()

    return commitHealth(await checkCandidateServerHealth({ serverUrl: server.url, auth: server.auth }))
  }

  /**
   * 检查所有服务器健康状态
   */
  async checkAllHealth(): Promise<void> {
    await Promise.all(this.servers.map(s => this.checkHealth(s.id)))
  }
}

// 单例导出
export const serverStore = new ServerStore()

function normalizeServerBackup(raw: unknown): ServerSettingsBackup {
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const servers = Array.isArray(parsed?.servers)
    ? parsed.servers
        .filter(
          (item): item is ServerConfig =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).id === 'string' &&
            typeof (item as Record<string, unknown>).name === 'string' &&
            typeof (item as Record<string, unknown>).url === 'string',
        )
        .map(item => ({
          id: item.id,
          name: item.name,
          url: item.url.replace(/\/+$/, ''),
          isDefault: item.isDefault === true,
          auth:
            item.auth &&
            typeof item.auth === 'object' &&
            typeof item.auth.username === 'string' &&
            typeof item.auth.password === 'string'
              ? { username: item.auth.username, password: item.auth.password }
              : undefined,
        }))
    : []

  const normalizedServers = servers.length
    ? servers
    : [
        {
          id: 'local',
          name: 'Local',
          url: API_BASE_URL,
          isDefault: true,
        },
      ]

  const activeServerId =
    typeof parsed?.activeServerId === 'string' && normalizedServers.some(server => server.id === parsed.activeServerId)
      ? parsed.activeServerId
      : (normalizedServers[0]?.id ?? null)

  return {
    servers: normalizedServers,
    activeServerId,
  }
}

export function exportServerSettingsBackup(): ServerSettingsBackup {
  return {
    servers: serverStore.getStoredServers().map(server => ({
      ...server,
      auth: server.auth ? { ...server.auth } : undefined,
    })),
    activeServerId: serverStore.getActiveServerId(),
  }
}

export function importServerSettingsBackup(raw: unknown): void {
  const normalized = normalizeServerBackup(raw)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized.servers))
  if (normalized.activeServerId) {
    localStorage.setItem(ACTIVE_SERVER_KEY, normalized.activeServerId)
    sessionStorage.setItem(ACTIVE_SERVER_KEY, normalized.activeServerId)
  } else {
    localStorage.removeItem(ACTIVE_SERVER_KEY)
    sessionStorage.removeItem(ACTIVE_SERVER_KEY)
  }
}

function normalizeServerTimestamp(timestamp: unknown): number | null {
  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) ? timestamp : null
  }

  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

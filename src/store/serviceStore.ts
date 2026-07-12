// ============================================
// Service Store - chimera serve 进程管理
// 管理自动启动设置 + 可执行文件路径 + 环境变量 + 进程生命周期
// 仅在 Tauri 桌面端有效
// ============================================

import { useSyncExternalStore } from 'react'

const STORAGE_KEY_AUTO_START = 'chimera-auto-start-service'
const STORAGE_KEY_BINARY_PATH = 'chimera-binary-path'
const STORAGE_KEY_ENV_VARS = 'chimera-service-env-vars'
const LEGACY_STORAGE_KEYS = {
  autoStart: 'opencode-auto-start-service',
  binaryPath: 'opencode-binary-path',
  envVars: 'opencode-service-env-vars',
} as const

/** 环境变量键值对 */
export interface EnvVar {
  key: string
  value: string
}

function readMigratedStorage<T>(key: string, legacyKey: string, parse: (raw: string) => T): T | null {
  const current = localStorage.getItem(key)
  if (current !== null) return parse(current)
  const legacy = localStorage.getItem(legacyKey)
  if (legacy === null) return null
  const parsed = parse(legacy)
  try {
    localStorage.setItem(key, legacy)
    localStorage.removeItem(legacyKey)
  } catch {
    return parsed
  }
  return parsed
}

function parseStoredBoolean(raw: string): boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error('Invalid stored boolean')
}

function parseStoredEnvVars(raw: string): EnvVar[] {
  const parsed: unknown = JSON.parse(raw)
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (item): item is EnvVar =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).key === 'string' &&
        typeof (item as Record<string, unknown>).value === 'string',
    )
  ) {
    throw new Error('Invalid stored environment variables')
  }
  return parsed.map(item => ({ key: item.key, value: item.value }))
}

export interface ServiceSettingsBackup {
  autoStart: boolean
  binaryPath: string
  envVars: EnvVar[]
}

interface ServiceStoreSnapshot {
  autoStart: boolean
  /** chimera 可执行文件路径，空字符串表示使用默认 "chimera" */
  binaryPath: string
  /** 传给子进程的额外环境变量 */
  envVars: EnvVar[]
  /** 自动检测到的 chimera 可执行文件路径 */
  detectedBinaryPath: string | null
  /** 服务是否正在运行（最后一次检测结果） */
  running: boolean
  /** 是否由我们启动（用于关闭时判断） */
  startedByUs: boolean
  /** 当前是否正在启动中 */
  starting: boolean
}

export class ServiceStore {
  private _autoStart: boolean
  private _binaryPath: string
  private _envVars: EnvVar[]
  private _detectedBinaryPath: string | null = null
  private _running = false
  private _startedByUs = false
  private _starting = false
  private _listeners: Set<() => void> = new Set()
  private _snapshot: ServiceStoreSnapshot

  constructor() {
    try {
      this._autoStart =
        readMigratedStorage(STORAGE_KEY_AUTO_START, LEGACY_STORAGE_KEYS.autoStart, parseStoredBoolean) ?? false
    } catch {
      this._autoStart = false
    }
    try {
      this._binaryPath =
        readMigratedStorage(STORAGE_KEY_BINARY_PATH, LEGACY_STORAGE_KEYS.binaryPath, value => value) ?? ''
    } catch {
      this._binaryPath = ''
    }
    try {
      this._envVars = readMigratedStorage(STORAGE_KEY_ENV_VARS, LEGACY_STORAGE_KEYS.envVars, parseStoredEnvVars) ?? []
    } catch {
      this._envVars = []
    }
    this._snapshot = this._buildSnapshot()
  }

  // ---- Getters ----

  get autoStart() {
    return this._autoStart
  }
  get binaryPath() {
    return this._binaryPath
  }
  get envVars() {
    return this._envVars
  }
  get running() {
    return this._running
  }
  get startedByUs() {
    return this._startedByUs
  }
  get starting() {
    return this._starting
  }

  /** 将手动路径作为最高优先级；留空时使用检测结果或 PATH 中的 chimera。 */
  get effectiveBinaryPath() {
    return this._binaryPath.trim() || this._detectedBinaryPath || 'chimera'
  }

  /** 将 envVars 转为 Record<string, string>，方便传给 Rust */
  get envVarsRecord(): Record<string, string> {
    const record: Record<string, string> = {}
    for (const { key, value } of this._envVars) {
      const k = key.trim()
      if (k) record[k] = value
    }
    return record
  }

  get detectedBinaryPath() {
    return this._detectedBinaryPath
  }

  // ---- Setters ----

  setAutoStart(v: boolean) {
    this._autoStart = v
    try {
      localStorage.setItem(STORAGE_KEY_AUTO_START, String(v))
    } catch {
      /* */
    }
    this._notify()
  }

  setBinaryPath(v: string) {
    this._binaryPath = v
    try {
      localStorage.setItem(STORAGE_KEY_BINARY_PATH, v)
    } catch {
      /* */
    }
    this._notify()
  }

  setEnvVars(vars: EnvVar[]) {
    this._envVars = vars
    try {
      localStorage.setItem(STORAGE_KEY_ENV_VARS, JSON.stringify(vars))
    } catch {
      /* */
    }
    this._notify()
  }

  setDetectedBinaryPath(path: string | null) {
    this._detectedBinaryPath = path
    this._notify()
  }

  setRunning(v: boolean) {
    this._running = v
    this._notify()
  }

  setStartedByUs(v: boolean) {
    this._startedByUs = v
    this._notify()
  }

  setStarting(v: boolean) {
    this._starting = v
    this._notify()
  }

  // ---- React useSyncExternalStore 接口 ----

  subscribe = (fn: () => void) => {
    this._listeners.add(fn)
    return () => {
      this._listeners.delete(fn)
    }
  }

  getSnapshot = (): ServiceStoreSnapshot => this._snapshot

  // ---- Internal ----

  private _buildSnapshot(): ServiceStoreSnapshot {
    return {
      autoStart: this._autoStart,
      binaryPath: this._binaryPath,
      envVars: this._envVars,
      detectedBinaryPath: this._detectedBinaryPath,
      running: this._running,
      startedByUs: this._startedByUs,
      starting: this._starting,
    }
  }

  private _notify() {
    this._snapshot = this._buildSnapshot()
    this._listeners.forEach(fn => fn())
  }
}

export const serviceStore = new ServiceStore()

export function exportServiceSettingsBackup(): ServiceSettingsBackup {
  return {
    autoStart: serviceStore.autoStart,
    binaryPath: serviceStore.binaryPath,
    envVars: serviceStore.envVars.map(item => ({ ...item })),
  }
}

export function importServiceSettingsBackup(raw: unknown): void {
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const envVars = Array.isArray(parsed?.envVars)
    ? parsed.envVars
        .filter(
          (item): item is EnvVar =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).key === 'string' &&
            typeof (item as Record<string, unknown>).value === 'string',
        )
        .map(item => ({ key: item.key, value: item.value }))
    : []

  serviceStore.setAutoStart(parsed?.autoStart === true)
  serviceStore.setBinaryPath(typeof parsed?.binaryPath === 'string' ? parsed.binaryPath : '')
  serviceStore.setEnvVars(envVars)
}

/** React hook */
export function useServiceStore() {
  return useSyncExternalStore(serviceStore.subscribe, serviceStore.getSnapshot)
}

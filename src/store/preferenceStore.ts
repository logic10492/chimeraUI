import {
  getWebUIPreferences,
  isWebUIPreferencesRevisionConflictError,
  updateWebUIPreferences,
} from '../api/preferences'
import { subscribeToEvents } from '../api/events'
import type { EventCallbacks } from '../types/api/event'
import type {
  WebUIColorMode,
  WebUIPreferences,
  WebUIPreferencesSnapshot,
  WebUIPreferencesUpdate,
} from '../types/api/preferences'
import { serverStore } from './serverStore'
import { themeStore } from './themeStore'

const COLOR_MODE_OVERRIDE_KEY = 'webui-preferences-color-mode-override'
const DEFAULT_DEBOUNCE_MS = 150

export type PreferenceSyncStatus = 'idle' | 'loading' | 'ready' | 'offline'
export type ColorModePreferenceScope = 'shared' | 'device'

export interface PreferenceStoreSnapshot {
  serverID: string
  status: PreferenceSyncStatus
  snapshot?: WebUIPreferencesSnapshot
  pending: WebUIPreferences
  deviceColorModeOverride?: WebUIColorMode
  error?: string
}

type PreferenceEntry = PreferenceStoreSnapshot

interface ThemePreferenceAdapter {
  subscribe(listener: () => void): () => void
  getWebUIPreferences(): WebUIPreferences
  applyWebUIPreferences(preferences: WebUIPreferences, colorModeOverride?: WebUIColorMode): void
}

interface PreferenceApi {
  get(serverID: string): Promise<WebUIPreferencesSnapshot>
  update(serverID: string, input: WebUIPreferencesUpdate): Promise<WebUIPreferencesSnapshot>
  isConflict(error: unknown): boolean
}

interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface PreferenceStoreOptions {
  theme?: ThemePreferenceAdapter
  api?: PreferenceApi
  storage?: PreferenceStorage
  subscribeEvents?: (callbacks: EventCallbacks) => () => void
  debounceMs?: number
}

function mergePreferences(base: WebUIPreferences, update: WebUIPreferences): WebUIPreferences {
  return {
    appearance:
      base.appearance || update.appearance
        ? {
            ...base.appearance,
            ...update.appearance,
          }
        : undefined,
    chat:
      base.chat || update.chat
        ? {
            ...base.chat,
            ...update.chat,
          }
        : undefined,
  }
}

function withoutColorMode(preferences: WebUIPreferences): WebUIPreferences {
  const appearance = { ...(preferences.appearance ?? {}) }
  delete appearance.colorMode
  return {
    appearance: Object.keys(appearance).length > 0 ? appearance : undefined,
    chat: preferences.chat,
  }
}

function hasPreferences(preferences: WebUIPreferences): boolean {
  return Object.keys(preferences.appearance ?? {}).length > 0 || Object.keys(preferences.chat ?? {}).length > 0
}

function preferencesEqual(left: WebUIPreferences, right: WebUIPreferences): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function colorModeOverrideKey(serverID: string): string {
  return `srv:${serverID}:${COLOR_MODE_OVERRIDE_KEY}`
}

function parseColorMode(value: string | null): WebUIColorMode | undefined {
  return value === 'system' || value === 'light' || value === 'dark' ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class PreferenceStore {
  private readonly theme: ThemePreferenceAdapter
  private readonly api: PreferenceApi
  private readonly storage: PreferenceStorage
  private readonly subscribeEvents: (callbacks: EventCallbacks) => () => void
  private readonly debounceMs: number
  private readonly entries = new Map<string, PreferenceEntry>()
  private readonly listeners = new Set<() => void>()
  private activeServerID = ''
  private generation = 0
  private initialized = false
  private suppressThemeWrite = false
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private unsubscribeTheme: (() => void) | undefined
  private unsubscribeEvents: (() => void) | undefined
  private lastThemePreferences: WebUIPreferences
  private view: PreferenceStoreSnapshot = {
    serverID: '',
    status: 'idle',
    pending: {},
  }

  constructor(options: PreferenceStoreOptions = {}) {
    this.theme = options.theme ?? themeStore
    this.api =
      options.api ??
      ({
        get: serverID => getWebUIPreferences(serverID),
        update: (serverID, input) => updateWebUIPreferences(input, serverID),
        isConflict: isWebUIPreferencesRevisionConflictError,
      } satisfies PreferenceApi)
    this.storage = options.storage ?? localStorage
    this.subscribeEvents = options.subscribeEvents ?? subscribeToEvents
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.lastThemePreferences = this.theme.getWebUIPreferences()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): PreferenceStoreSnapshot => this.view

  init(serverID = serverStore.getActiveServerId()): void {
    if (this.initialized) return
    this.initialized = true
    this.unsubscribeTheme = this.theme.subscribe(() => this.handleThemeChange())
    this.unsubscribeEvents = this.subscribeEvents({
      onWebUIPreferencesUpdated: (snapshot, scope) => this.handleRemoteSnapshot(scope.serverID, snapshot),
      onEventGap: (_event, scope) => this.resync(scope.serverID),
      onGlobalDisposed: (_event, scope) => this.resync(scope.serverID),
      onReconnected: (_reason, reconnectedServerID) => this.resync(reconnectedServerID),
    })
    this.switchServer(serverID)
  }

  destroy(): void {
    this.unsubscribeTheme?.()
    this.unsubscribeEvents?.()
    this.unsubscribeTheme = undefined
    this.unsubscribeEvents = undefined
    this.initialized = false
    this.clearFlushTimer()
  }

  switchServer(serverID: string): void {
    this.generation++
    this.clearFlushTimer()
    this.activeServerID = serverID
    const entry = this.getEntry(serverID)
    entry.deviceColorModeOverride = parseColorMode(this.storage.getItem(colorModeOverrideKey(serverID)))
    this.lastThemePreferences = this.theme.getWebUIPreferences()
    if (entry.snapshot) this.applyActiveEntry(entry)
    this.emit()
    void this.refresh(serverID)
  }

  async refresh(serverID = this.activeServerID): Promise<void> {
    if (!serverID || serverID !== this.activeServerID) return
    const generation = this.generation
    const entry = this.getEntry(serverID)
    entry.status = 'loading'
    entry.error = undefined
    this.emit()

    try {
      const snapshot = await this.api.get(serverID)
      if (!this.isCurrent(serverID, generation)) return

      if (!snapshot.initialized) {
        if (!this.isSnapshotNewer(entry, snapshot)) return
        await this.initializeServer(serverID, generation, snapshot)
        return
      }

      this.acceptSnapshot(entry, snapshot)
      if (hasPreferences(entry.pending)) this.scheduleFlush()
    } catch (error) {
      if (!this.isCurrent(serverID, generation)) return
      entry.status = 'offline'
      entry.error = errorMessage(error)
      this.emit()
    }
  }

  async flushNow(): Promise<void> {
    this.clearFlushTimer()
    const serverID = this.activeServerID
    if (!serverID) return
    const generation = this.generation
    const entry = this.getEntry(serverID)
    if (!hasPreferences(entry.pending)) return
    if (!entry.snapshot?.initialized) {
      await this.refresh(serverID)
      return
    }

    const pending = entry.pending
    try {
      const snapshot = await this.api.update(serverID, {
        revision: entry.snapshot.revision,
        preferences: mergePreferences(entry.snapshot.preferences, pending),
      })
      if (!this.isCurrent(serverID, generation)) return
      const clearedPending = preferencesEqual(entry.pending, pending)
      if (clearedPending) entry.pending = {}
      if (!this.acceptSnapshot(entry, snapshot) && clearedPending) entry.pending = pending
      if (hasPreferences(entry.pending)) this.scheduleFlush()
    } catch (error) {
      if (!this.isCurrent(serverID, generation)) return
      if (!this.api.isConflict(error)) {
        entry.status = 'offline'
        entry.error = errorMessage(error)
        this.emit()
        return
      }
      await this.rebaseAndRetry(serverID, generation)
    }
  }

  setColorModeScope(scope: ColorModePreferenceScope): void {
    const entry = this.getEntry(this.activeServerID)
    if (scope === 'device') {
      const colorMode = this.theme.getWebUIPreferences().appearance?.colorMode ?? 'system'
      entry.pending = withoutColorMode(entry.pending)
      if (!hasPreferences(entry.pending)) this.clearFlushTimer()
      entry.deviceColorModeOverride = colorMode
      this.storage.setItem(colorModeOverrideKey(entry.serverID), colorMode)
      this.emit()
      return
    }

    if (entry.deviceColorModeOverride === undefined) return
    entry.deviceColorModeOverride = undefined
    this.storage.removeItem(colorModeOverrideKey(entry.serverID))
    this.applyActiveEntry(entry)
    this.emit()
  }

  private async initializeServer(
    serverID: string,
    generation: number,
    initialSnapshot: WebUIPreferencesSnapshot,
  ): Promise<void> {
    const entry = this.getEntry(serverID)
    const migratedPreferences = mergePreferences(this.theme.getWebUIPreferences(), entry.pending)
    const pending = entry.pending

    try {
      const snapshot = await this.api.update(serverID, {
        revision: initialSnapshot.revision,
        preferences: migratedPreferences,
      })
      if (!this.isCurrent(serverID, generation)) return
      const clearedPending = preferencesEqual(entry.pending, pending)
      if (clearedPending) entry.pending = {}
      if (!this.acceptSnapshot(entry, snapshot) && clearedPending) entry.pending = pending
      if (hasPreferences(entry.pending)) this.scheduleFlush()
    } catch (error) {
      if (!this.isCurrent(serverID, generation)) return
      if (!this.api.isConflict(error)) throw error
      const snapshot = await this.api.get(serverID)
      if (!this.isCurrent(serverID, generation)) return
      this.acceptSnapshot(entry, snapshot)
      if (hasPreferences(entry.pending)) this.scheduleFlush()
    }
  }

  private async rebaseAndRetry(serverID: string, generation: number): Promise<void> {
    const entry = this.getEntry(serverID)
    try {
      const latest = await this.api.get(serverID)
      if (!this.isCurrent(serverID, generation)) return
      this.acceptSnapshot(entry, latest)
      const base = entry.snapshot
      if (!base) return

      const retryPending = entry.pending
      const snapshot = await this.api.update(serverID, {
        revision: base.revision,
        preferences: mergePreferences(base.preferences, retryPending),
      })
      if (!this.isCurrent(serverID, generation)) return
      const clearedPending = preferencesEqual(entry.pending, retryPending)
      if (clearedPending) entry.pending = {}
      if (!this.acceptSnapshot(entry, snapshot) && clearedPending) entry.pending = retryPending
      if (hasPreferences(entry.pending)) this.scheduleFlush()
    } catch (error) {
      if (!this.isCurrent(serverID, generation)) return
      entry.status = 'offline'
      entry.error = errorMessage(error)
      this.emit()
    }
  }

  private handleThemeChange(): void {
    const current = this.theme.getWebUIPreferences()
    if (this.suppressThemeWrite || !this.activeServerID) {
      this.lastThemePreferences = current
      return
    }

    const previous = this.lastThemePreferences
    this.lastThemePreferences = current
    const entry = this.getEntry(this.activeServerID)
    const appearance: NonNullable<WebUIPreferences['appearance']> = {}
    const chat: NonNullable<WebUIPreferences['chat']> = {}

    if (current.appearance?.presetId !== previous.appearance?.presetId) {
      appearance.presetId = current.appearance?.presetId
    }
    if (current.appearance?.colorMode !== previous.appearance?.colorMode) {
      const colorMode = current.appearance?.colorMode ?? 'system'
      if (entry.deviceColorModeOverride !== undefined) {
        entry.deviceColorModeOverride = colorMode
        this.storage.setItem(colorModeOverrideKey(entry.serverID), colorMode)
      } else {
        appearance.colorMode = colorMode
      }
    }
    if (current.chat?.collapseUserMessages !== previous.chat?.collapseUserMessages) {
      chat.collapseUserMessages = current.chat?.collapseUserMessages
    }
    if (current.chat?.renderUserMarkdown !== previous.chat?.renderUserMarkdown) {
      chat.renderUserMarkdown = current.chat?.renderUserMarkdown
    }
    if (current.chat?.reasoningDisplayMode !== previous.chat?.reasoningDisplayMode) {
      chat.reasoningDisplayMode = current.chat?.reasoningDisplayMode
    }

    const update: WebUIPreferences = {
      appearance: Object.keys(appearance).length > 0 ? appearance : undefined,
      chat: Object.keys(chat).length > 0 ? chat : undefined,
    }
    if (hasPreferences(update)) {
      entry.pending = mergePreferences(entry.pending, update)
      this.scheduleFlush()
    }
    this.emit()
  }

  private handleRemoteSnapshot(serverID: string, snapshot: WebUIPreferencesSnapshot): void {
    if (serverID !== this.activeServerID) return
    const entry = this.getEntry(serverID)
    if (!this.acceptSnapshot(entry, snapshot)) return
    if (hasPreferences(entry.pending)) this.scheduleFlush()
  }

  private resync(serverID: string): void {
    if (serverID !== this.activeServerID) return
    void this.refresh(serverID)
  }

  private acceptSnapshot(entry: PreferenceEntry, snapshot: WebUIPreferencesSnapshot): boolean {
    if (!this.isSnapshotNewer(entry, snapshot)) return false
    entry.snapshot = snapshot
    entry.status = 'ready'
    entry.error = undefined
    this.applyActiveEntry(entry)
    this.emit()
    return true
  }

  private isSnapshotNewer(entry: PreferenceEntry, snapshot: WebUIPreferencesSnapshot): boolean {
    return snapshot.revision > (entry.snapshot?.revision ?? -1)
  }

  private applyActiveEntry(entry: PreferenceEntry): void {
    if (entry.serverID !== this.activeServerID || !entry.snapshot) return
    this.suppressThemeWrite = true
    try {
      this.theme.applyWebUIPreferences(
        mergePreferences(entry.snapshot.preferences, entry.pending),
        entry.deviceColorModeOverride,
      )
      this.lastThemePreferences = this.theme.getWebUIPreferences()
    } finally {
      this.suppressThemeWrite = false
    }
  }

  private scheduleFlush(): void {
    this.clearFlushTimer()
    this.flushTimer = setTimeout(() => void this.flushNow(), this.debounceMs)
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = undefined
  }

  private isCurrent(serverID: string, generation: number): boolean {
    return serverID === this.activeServerID && generation === this.generation
  }

  private getEntry(serverID: string): PreferenceEntry {
    const existing = this.entries.get(serverID)
    if (existing) return existing
    const entry: PreferenceEntry = {
      serverID,
      status: 'idle',
      pending: {},
      deviceColorModeOverride: parseColorMode(this.storage.getItem(colorModeOverrideKey(serverID))),
    }
    this.entries.set(serverID, entry)
    return entry
  }

  private emit(): void {
    const entry = this.activeServerID ? this.getEntry(this.activeServerID) : undefined
    this.view = entry
      ? {
          serverID: entry.serverID,
          status: entry.status,
          snapshot: entry.snapshot,
          pending: entry.pending,
          deviceColorModeOverride: entry.deviceColorModeOverride,
          error: entry.error,
        }
      : { serverID: '', status: 'idle', pending: {} }
    this.listeners.forEach(listener => listener())
  }
}

export const preferenceStore = new PreferenceStore()

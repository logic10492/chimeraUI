import { describe, expect, it, vi } from 'vitest'
import type { EventCallbacks } from '../types/api/event'
import type { WebUIPreferences, WebUIPreferencesSnapshot } from '../types/api/preferences'
import { PreferenceStore } from './preferenceStore'

class FakeThemeStore {
  private listeners = new Set<() => void>()
  private preferences: WebUIPreferences

  constructor(preferences: WebUIPreferences) {
    this.preferences = preferences
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getWebUIPreferences = () => this.preferences

  applyWebUIPreferences = (preferences: WebUIPreferences, colorModeOverride?: 'system' | 'light' | 'dark') => {
    this.preferences = {
      ...preferences,
      appearance: {
        ...preferences.appearance,
        colorMode: colorModeOverride ?? preferences.appearance?.colorMode,
      },
    }
    this.listeners.forEach(listener => listener())
  }

  mutate(update: WebUIPreferences) {
    this.preferences = {
      appearance: { ...this.preferences.appearance, ...update.appearance },
      chat: { ...this.preferences.chat, ...update.chat },
    }
    this.listeners.forEach(listener => listener())
  }
}

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  }
}

function snapshot(
  revision: number,
  preferences: WebUIPreferences,
  initialized = true,
): WebUIPreferencesSnapshot {
  return { schemaVersion: 1, revision, initialized, preferences }
}

function localPreferences(): WebUIPreferences {
  return {
    appearance: { presetId: 'chimera', colorMode: 'system' },
    chat: {
      collapseUserMessages: true,
      renderUserMarkdown: false,
      reasoningDisplayMode: 'capsule',
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(options: {
  theme?: FakeThemeStore
  get?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
  storage?: ReturnType<typeof memoryStorage>
}) {
  const theme = options.theme ?? new FakeThemeStore(localPreferences())
  const get = options.get ?? vi.fn()
  const update = options.update ?? vi.fn()
  const storage = options.storage ?? memoryStorage()
  let callbacks: EventCallbacks = {}
  const store = new PreferenceStore({
    theme,
    api: {
      get,
      update,
      isConflict: error => !!error && typeof error === 'object' && 'name' in error && error.name === 'conflict',
    },
    storage,
    subscribeEvents(next) {
      callbacks = next
      return () => {}
    },
    debounceMs: 1,
  })
  return { store, theme, get, update, storage, callbacks: () => callbacks }
}

describe('PreferenceStore', () => {
  it('migrates the Phase 1 whitelist exactly once without deleting legacy local storage', async () => {
    const storage = memoryStorage({ legacy: 'keep' })
    const get = vi.fn().mockResolvedValue(snapshot(0, {}, false))
    const update = vi.fn().mockResolvedValue(snapshot(1, localPreferences()))
    const { store } = setup({ get, update, storage })

    store.init('server-a')
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('server-a', { revision: 0, preferences: localPreferences() })
    expect(storage.values.get('legacy')).toBe('keep')
    store.destroy()
  })

  it('applies newer SSE snapshots without creating a ThemeStore write-back loop', async () => {
    const get = vi.fn().mockResolvedValue(snapshot(1, localPreferences()))
    const update = vi.fn()
    const { store, theme, callbacks } = setup({ get, update })
    store.init('server-a')
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))

    callbacks().onWebUIPreferencesUpdated?.(
      snapshot(2, { ...localPreferences(), chat: { ...localPreferences().chat, renderUserMarkdown: true } }),
      { serverID: 'server-a', directory: 'global' },
    )
    callbacks().onWebUIPreferencesUpdated?.(
      snapshot(1, { appearance: { colorMode: 'light' } }),
      { serverID: 'server-a', directory: 'global' },
    )

    expect(theme.getWebUIPreferences().chat?.renderUserMarkdown).toBe(true)
    expect(theme.getWebUIPreferences().appearance?.colorMode).toBe('system')
    expect(update).not.toHaveBeenCalled()
    store.destroy()
  })

  it('keeps a newer SSE snapshot when an older refresh response arrives later', async () => {
    const refresh = createDeferred<WebUIPreferencesSnapshot>()
    const get = vi.fn().mockResolvedValueOnce(snapshot(1, localPreferences())).mockImplementationOnce(() => refresh.promise)
    const { store, theme, callbacks } = setup({ get })
    store.init('server-a')
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))

    const refreshing = store.refresh()
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    callbacks().onWebUIPreferencesUpdated?.(
      snapshot(3, { ...localPreferences(), appearance: { presetId: 'remote', colorMode: 'dark' } }),
      { serverID: 'server-a', directory: 'global' },
    )
    refresh.resolve(snapshot(2, { ...localPreferences(), appearance: { presetId: 'stale', colorMode: 'light' } }))
    await refreshing

    expect(store.getSnapshot().snapshot?.revision).toBe(3)
    expect(theme.getWebUIPreferences().appearance).toEqual({ presetId: 'remote', colorMode: 'dark' })
    store.destroy()
  })

  it('refetches, rebases, and retries once after a revision conflict', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(snapshot(1, localPreferences()))
      .mockResolvedValueOnce(snapshot(2, { ...localPreferences(), appearance: { presetId: 'remote', colorMode: 'dark' } }))
    const update = vi
      .fn()
      .mockRejectedValueOnce({ name: 'conflict' })
      .mockResolvedValueOnce(
        snapshot(3, {
          appearance: { presetId: 'remote', colorMode: 'dark' },
          chat: { ...localPreferences().chat, collapseUserMessages: false },
        }),
      )
    const { store, theme } = setup({ get, update })
    store.init('server-a')
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))

    theme.mutate({ chat: { collapseUserMessages: false } })
    await store.flushNow()

    expect(update).toHaveBeenNthCalledWith(1, 'server-a', {
      revision: 1,
      preferences: {
        ...localPreferences(),
        chat: { ...localPreferences().chat, collapseUserMessages: false },
      },
    })
    expect(update).toHaveBeenNthCalledWith(2, 'server-a', {
      revision: 2,
      preferences: {
        appearance: { presetId: 'remote', colorMode: 'dark' },
        chat: { ...localPreferences().chat, collapseUserMessages: false },
      },
    })
    expect(store.getSnapshot().snapshot?.revision).toBe(3)
    store.destroy()
  })

  it('discards an old server response after switching generations', async () => {
    const serverA = createDeferred<WebUIPreferencesSnapshot>()
    const serverB = createDeferred<WebUIPreferencesSnapshot>()
    const get = vi.fn((serverID: string) => (serverID === 'server-a' ? serverA.promise : serverB.promise))
    const { store, theme } = setup({ get })

    store.init('server-a')
    store.switchServer('server-b')
    serverB.resolve(snapshot(1, { ...localPreferences(), appearance: { presetId: 'chimera', colorMode: 'dark' } }))
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))
    serverA.resolve(snapshot(1, { ...localPreferences(), appearance: { presetId: 'chimera', colorMode: 'light' } }))
    await Promise.resolve()

    expect(store.getSnapshot().serverID).toBe('server-b')
    expect(theme.getWebUIPreferences().appearance?.colorMode).toBe('dark')
    store.destroy()
  })

  it('keeps a color mode device override local and restores the shared value when cleared', async () => {
    const shared = { ...localPreferences(), appearance: { presetId: 'chimera', colorMode: 'dark' as const } }
    const get = vi.fn().mockResolvedValue(snapshot(1, shared))
    const update = vi.fn()
    const { store, theme, storage } = setup({ get, update })
    store.init('server-a')
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))

    store.setColorModeScope('device')
    theme.mutate({ appearance: { colorMode: 'light' } })
    await store.flushNow()

    expect(update).not.toHaveBeenCalled()
    expect(storage.values.get('srv:server-a:webui-preferences-color-mode-override')).toBe('light')
    expect(theme.getWebUIPreferences().appearance?.colorMode).toBe('light')

    store.setColorModeScope('shared')
    expect(storage.values.has('srv:server-a:webui-preferences-color-mode-override')).toBe(false)
    expect(theme.getWebUIPreferences().appearance?.colorMode).toBe('dark')
    store.destroy()
  })
  it('flushes a preference changed while first-time migration is in flight', async () => {
    const firstUpdate = createDeferred<WebUIPreferencesSnapshot>()
    const get = vi.fn().mockResolvedValue(snapshot(0, {}, false))
    const update = vi
      .fn()
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValueOnce(
        snapshot(2, {
          ...localPreferences(),
          chat: { ...localPreferences().chat, renderUserMarkdown: true },
        }),
      )
    const { store, theme } = setup({ get, update })

    store.init('server-a')
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    theme.mutate({ chat: { renderUserMarkdown: true } })
    firstUpdate.resolve(snapshot(1, localPreferences()))

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update).toHaveBeenNthCalledWith(2, 'server-a', {
      revision: 1,
      preferences: {
        ...localPreferences(),
        chat: { ...localPreferences().chat, renderUserMarkdown: true },
      },
    })
    store.destroy()
  })

  it('drops a queued shared color-mode write when switching to a device override', async () => {
    const get = vi.fn().mockResolvedValue(snapshot(1, localPreferences()))
    const update = vi.fn()
    const { store, theme } = setup({ get, update })
    store.init('server-a')
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))

    theme.mutate({ appearance: { colorMode: 'dark' } })
    store.setColorModeScope('device')
    await store.flushNow()

    expect(update).not.toHaveBeenCalled()
    expect(store.getSnapshot().deviceColorModeOverride).toBe('dark')
    store.destroy()
  })

})

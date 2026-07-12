import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RELEASES_API_URL,
  UpdateStore,
  compareVersions,
  hasUpdateAvailable,
  shouldShowUpdateToast,
} from './updateStore'

describe('updateStore helpers', () => {
  it('compares versions with optional v prefix', () => {
    expect(compareVersions('v0.5.2', '0.5.1')).toBeGreaterThan(0)
    expect(compareVersions('0.5.1', 'v0.5.1')).toBe(0)
    expect(compareVersions('0.5', '0.5.1')).toBeLessThan(0)
  })

  it('detects whether an update toast should be shown', () => {
    const baseState = {
      currentVersion: '0.5.1',
      channel: 'latest',
      latestRelease: {
        version: '0.5.2',
        tagName: 'v0.5.2',
        url: 'https://example.com',
        publishedAt: null,
        name: null,
      },
      lastCheckedAt: Date.now(),
      dismissedVersion: null,
      hiddenToastVersion: null,
      checking: false,
      error: null,
    }

    expect(hasUpdateAvailable(baseState)).toBe(true)
    expect(shouldShowUpdateToast(baseState)).toBe(true)
    expect(shouldShowUpdateToast({ ...baseState, hiddenToastVersion: '0.5.2' })).toBe(false)
    expect(shouldShowUpdateToast({ ...baseState, dismissedVersion: '0.5.2' })).toBe(false)
  })
})

describe('UpdateStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('loads the latest release and persists dismissal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v0.5.2',
          html_url: 'https://github.com/coding-chimera/chimera/releases/tag/v0.5.2',
          published_at: '2026-04-15T00:00:00Z',
          name: 'Chimera v0.5.2',
        }),
      }),
    )

    const store = new UpdateStore('0.5.1', 'latest')
    await store.checkForUpdates({ force: true })

    expect(fetch).toHaveBeenCalledWith(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    })

    expect(store.getSnapshot().latestRelease?.version).toBe('0.5.2')
    expect(hasUpdateAvailable(store.getSnapshot())).toBe(true)

    store.dismissCurrentVersion()

    expect(store.getSnapshot().dismissedVersion).toBe('0.5.2')
    expect(shouldShowUpdateToast(store.getSnapshot())).toBe(false)
    expect(store.getSnapshot().channel).toBe('latest')
    expect(localStorage.getItem('chimera:update-check')).toContain('0.5.2')
  })

  it('migrates the legacy update storage key', () => {
    localStorage.setItem(
      'opencode:update-check',
      JSON.stringify({ latestRelease: null, lastCheckedAt: 123, dismissedVersion: '0.4.0' }),
    )

    const store = new UpdateStore('0.5.1', 'beta')

    expect(store.getSnapshot().lastCheckedAt).toBe(123)
    expect(store.getSnapshot().channel).toBe('beta')
    expect(localStorage.getItem('chimera:update-check')).toContain('0.4.0')
    expect(localStorage.getItem('opencode:update-check')).toBeNull()
  })

  it('preserves malformed legacy update state', () => {
    localStorage.setItem('opencode:update-check', '{')

    const store = new UpdateStore('0.5.1', 'latest')

    expect(store.getSnapshot().latestRelease).toBeNull()
    expect(localStorage.getItem('chimera:update-check')).toBeNull()
    expect(localStorage.getItem('opencode:update-check')).toBe('{')
  })

  it('uses the current update key without consuming legacy state', () => {
    localStorage.setItem(
      'chimera:update-check',
      JSON.stringify({ latestRelease: null, lastCheckedAt: 456, dismissedVersion: '0.5.0' }),
    )
    localStorage.setItem(
      'opencode:update-check',
      JSON.stringify({ latestRelease: null, lastCheckedAt: 123, dismissedVersion: '0.4.0' }),
    )

    const store = new UpdateStore('0.5.1', 'latest')

    expect(store.getSnapshot().lastCheckedAt).toBe(456)
    expect(store.getSnapshot().dismissedVersion).toBe('0.5.0')
    expect(localStorage.getItem('opencode:update-check')).not.toBeNull()
  })

  it('keeps validated legacy state when migration writes fail', () => {
    localStorage.setItem(
      'opencode:update-check',
      JSON.stringify({ latestRelease: null, lastCheckedAt: 123, dismissedVersion: '0.4.0' }),
    )
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'chimera:update-check') throw new Error('blocked')
      return originalSetItem.call(this, key, value)
    })

    const store = new UpdateStore('0.5.1', 'latest')

    expect(store.getSnapshot().lastCheckedAt).toBe(123)
    expect(localStorage.getItem('chimera:update-check')).toBeNull()
    expect(localStorage.getItem('opencode:update-check')).not.toBeNull()
  })
})

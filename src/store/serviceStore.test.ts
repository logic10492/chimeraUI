import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceStore } from './serviceStore'

describe('ServiceStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('defaults to the chimera binary', () => {
    const store = new ServiceStore()

    expect(store.effectiveBinaryPath).toBe('chimera')
  })

  it('migrates legacy opencode service settings to chimera keys', () => {
    localStorage.setItem('opencode-auto-start-service', 'true')
    localStorage.setItem('opencode-binary-path', '/opt/custom/opencode')
    localStorage.setItem('opencode-service-env-vars', JSON.stringify([{ key: 'HTTPS_PROXY', value: 'proxy' }]))

    const store = new ServiceStore()

    expect(store.autoStart).toBe(true)
    expect(store.effectiveBinaryPath).toBe('/opt/custom/opencode')
    expect(store.envVars).toEqual([{ key: 'HTTPS_PROXY', value: 'proxy' }])
    expect(localStorage.getItem('chimera-auto-start-service')).toBe('true')
    expect(localStorage.getItem('chimera-binary-path')).toBe('/opt/custom/opencode')
    expect(localStorage.getItem('chimera-service-env-vars')).toContain('HTTPS_PROXY')
    expect(localStorage.getItem('opencode-auto-start-service')).toBeNull()
    expect(localStorage.getItem('opencode-binary-path')).toBeNull()
    expect(localStorage.getItem('opencode-service-env-vars')).toBeNull()
  })

  it.each(['{', JSON.stringify([{ key: 'HTTPS_PROXY' }])])('preserves invalid legacy environment settings: %s', raw => {
    localStorage.setItem('opencode-service-env-vars', raw)

    const store = new ServiceStore()

    expect(store.envVars).toEqual([])
    expect(localStorage.getItem('chimera-service-env-vars')).toBeNull()
    expect(localStorage.getItem('opencode-service-env-vars')).toBe(raw)
  })

  it('uses current service settings without consuming legacy values', () => {
    localStorage.setItem('chimera-service-env-vars', JSON.stringify([{ key: 'CURRENT', value: 'yes' }]))
    localStorage.setItem('opencode-service-env-vars', JSON.stringify([{ key: 'LEGACY', value: 'yes' }]))

    const store = new ServiceStore()

    expect(store.envVars).toEqual([{ key: 'CURRENT', value: 'yes' }])
    expect(localStorage.getItem('opencode-service-env-vars')).not.toBeNull()
  })

  it('keeps validated legacy service settings when migration writes fail', () => {
    const legacy = JSON.stringify([{ key: 'HTTPS_PROXY', value: 'proxy' }])
    localStorage.setItem('opencode-service-env-vars', legacy)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'chimera-service-env-vars') throw new Error('blocked')
      return originalSetItem.call(this, key, value)
    })

    const store = new ServiceStore()

    expect(store.envVars).toEqual([{ key: 'HTTPS_PROXY', value: 'proxy' }])
    expect(localStorage.getItem('chimera-service-env-vars')).toBeNull()
    expect(localStorage.getItem('opencode-service-env-vars')).toBe(legacy)
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import {
  getRuntimePlatform,
  isTauri,
  isTauriAndroid,
  isTauriDesktop,
  isTauriIOS,
  isTauriMobile,
  extToMime,
} from './tauri'

const win = window as Window & {
  __TAURI_INTERNALS__?: object
  __CHIMERA_RUNTIME_PLATFORM__?: 'web' | 'tauri-desktop' | 'tauri-android' | 'tauri-ios'
}
const originalUserAgent = navigator.userAgent

function setUserAgent(userAgent: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
}

afterEach(() => {
  delete win.__TAURI_INTERNALS__
  delete win.__CHIMERA_RUNTIME_PLATFORM__
  setUserAgent(originalUserAgent)
})

describe('runtime platform detection', () => {
  it('classifies normal browser and iOS PWA runtimes as web', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')

    expect(getRuntimePlatform()).toBe('web')
    expect(isTauri()).toBe(false)
    expect(isTauriIOS()).toBe(false)
  })

  it('uses the native shell platform marker authoritatively', () => {
    win.__TAURI_INTERNALS__ = {}
    win.__CHIMERA_RUNTIME_PLATFORM__ = 'tauri-android'
    setUserAgent('desktop-like-webview')

    expect(getRuntimePlatform()).toBe('tauri-android')
    expect(isTauriAndroid()).toBe(true)
    expect(isTauriMobile()).toBe(true)
    expect(isTauriDesktop()).toBe(false)
  })

  it('distinguishes native iOS from iOS web', () => {
    win.__TAURI_INTERNALS__ = {}
    win.__CHIMERA_RUNTIME_PLATFORM__ = 'tauri-ios'

    expect(getRuntimePlatform()).toBe('tauri-ios')
    expect(isTauriIOS()).toBe(true)
    expect(isTauriMobile()).toBe(true)
  })

  it('falls back safely to the WebView user agent for older native shells', () => {
    win.__TAURI_INTERNALS__ = {}
    setUserAgent('Mozilla/5.0 (Linux; Android 15)')
    expect(getRuntimePlatform()).toBe('tauri-android')

    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    expect(getRuntimePlatform()).toBe('tauri-desktop')
  })
})

describe('extToMime', () => {
  it('returns correct MIME for common image types', () => {
    expect(extToMime('png')).toBe('image/png')
    expect(extToMime('jpg')).toBe('image/jpeg')
    expect(extToMime('svg')).toBe('image/svg+xml')
  })

  it('returns correct MIME for audio/video types', () => {
    expect(extToMime('mp3')).toBe('audio/mpeg')
    expect(extToMime('mp4')).toBe('video/mp4')
  })

  it('returns octet-stream for unknown extensions', () => {
    expect(extToMime('xyz')).toBe('application/octet-stream')
    expect(extToMime('foo')).toBe('application/octet-stream')
  })
})

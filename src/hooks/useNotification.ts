// ============================================
// useNotification - 通知系统
// ============================================
//
// 当 AI 完成回复、请求权限、提问或出错时，发送通知
// Tauri 环境下使用原生通知（@tauri-apps/plugin-notification）
// 浏览器环境下使用 Service Worker / Notification API
//
// Android Chrome 不支持 new Notification()，必须通过
// ServiceWorkerRegistration.showNotification() 发送

import { useState, useCallback, useEffect, useRef } from 'react'
import { STORAGE_KEY_NOTIFICATIONS_ENABLED } from '../constants/storage'
import { serverStore } from '../store/serverStore'
import { isTauri } from '../utils/tauri'

export const NATIVE_NOTIFICATION_SCHEMA_VERSION = 1

export interface NotificationData {
  sessionID: string
  serverID: string
  directory?: string
}

interface NativeNotificationExtra extends NotificationData {
  schemaVersion: typeof NATIVE_NOTIFICATION_SCHEMA_VERSION
}

let swRegistration: ServiceWorkerRegistration | null = null
let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null
let nativeActionListenerPromise: Promise<void> | null = null

export function buildNotificationSessionHash(data: Pick<NotificationData, 'sessionID' | 'directory'>) {
  const directory = data.directory ? `?dir=${encodeURIComponent(data.directory)}` : ''
  return `#/session/${encodeURIComponent(data.sessionID)}${directory}`
}

export function buildNotificationAssetURL(asset: string, baseURL = import.meta.env.BASE_URL || '/') {
  return new URL(asset, new URL(baseURL, window.location.origin)).href
}

export function parseNativeNotificationExtra(value: unknown): NativeNotificationExtra | null {
  if (!value || typeof value !== 'object') return null
  const extra = value as Record<string, unknown>
  if (extra.schemaVersion !== NATIVE_NOTIFICATION_SCHEMA_VERSION) return null
  if (typeof extra.serverID !== 'string' || !extra.serverID) return null
  if (typeof extra.sessionID !== 'string' || !extra.sessionID) return null
  if (extra.directory !== undefined && typeof extra.directory !== 'string') return null
  return {
    schemaVersion: NATIVE_NOTIFICATION_SCHEMA_VERSION,
    serverID: extra.serverID,
    sessionID: extra.sessionID,
    directory: extra.directory,
  }
}

export function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (isTauri()) return Promise.resolve(null)
  if (swRegistration) return Promise.resolve(swRegistration)
  if (swRegistrationPromise) return swRegistrationPromise
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)

  const baseURL = new URL(import.meta.env.BASE_URL || '/', window.location.origin)
  swRegistrationPromise = navigator.serviceWorker
    .register(new URL('notification-sw.js', baseURL), { scope: baseURL.pathname })
    .then(registration => {
      swRegistration = registration
      return registration
    })
    .catch(() => null)
    .finally(() => {
      swRegistrationPromise = null
    })
  return swRegistrationPromise
}

export function installNativeNotificationActionHandler(): Promise<void> {
  if (!isTauri()) return Promise.resolve()
  if (nativeActionListenerPromise) return nativeActionListenerPromise

  nativeActionListenerPromise = Promise.all([
    import('@tauri-apps/plugin-notification'),
    import('@tauri-apps/api/window'),
  ]).then(async ([notification, tauriWindow]) => {
    await notification.onAction(action => {
      const extra = parseNativeNotificationExtra(action.extra)
      if (!extra) return
      if (!serverStore.getServers().some(server => server.id === extra.serverID)) return

      const currentWindow = tauriWindow.getCurrentWindow()
      void currentWindow.show()
      void currentWindow.setFocus()
      serverStore.setActiveServer(extra.serverID)
      window.location.hash = buildNotificationSessionHash(extra)
    })
  })

  return nativeActionListenerPromise
}

export async function sendTauriNotification(title: string, body: string, data?: NotificationData): Promise<void> {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification')
    const granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted'
    if (!granted) return

    sendNotification({
      title,
      body,
      extra: data
        ? {
            schemaVersion: NATIVE_NOTIFICATION_SCHEMA_VERSION,
            serverID: data.serverID,
            directory: data.directory,
            sessionID: data.sessionID,
          }
        : undefined,
    })
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[Notification/Tauri] Failed:', error)
  }
}

async function checkTauriPermission(): Promise<NotificationPermission> {
  try {
    const { isPermissionGranted } = await import('@tauri-apps/plugin-notification')
    return (await isPermissionGranted()) ? 'granted' : 'default'
  } catch {
    return 'denied'
  }
}

async function requestTauriPermission(): Promise<NotificationPermission> {
  try {
    const { requestPermission } = await import('@tauri-apps/plugin-notification')
    return (await requestPermission()) === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

export function useNotification() {
  const [enabled, setEnabledState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_NOTIFICATIONS_ENABLED) === 'true'
    } catch {
      return false
    }
  })
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (isTauri()) return 'default'
    if (typeof Notification === 'undefined') return 'denied'
    return Notification.permission
  })
  const enabledRef = useRef(enabled)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    if (isTauri()) void checkTauriPermission().then(setPermission)
  }, [])

  useEffect(() => {
    if (enabled && !isTauri()) void registerNotificationServiceWorker()
  }, [enabled])

  useEffect(() => {
    if (isTauri() || !('serviceWorker' in navigator)) return

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'notification-click') return
      const data = event.data as { type: string; sessionID?: unknown; sessionId?: unknown; directory?: unknown }
      const sessionID = typeof data.sessionID === 'string' ? data.sessionID : data.sessionId
      if (typeof sessionID !== 'string' || !sessionID) return
      window.focus()
      window.location.hash = buildNotificationSessionHash({
        sessionID,
        directory: typeof data.directory === 'string' ? data.directory : undefined,
      })
    }

    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [])

  const setEnabled = useCallback(async (value: boolean) => {
    if (value) {
      if (isTauri()) {
        const result = await requestTauriPermission()
        setPermission(result)
        if (result !== 'granted') return
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const result = await Notification.requestPermission()
        setPermission(result)
        if (result !== 'granted') return
      }
    }

    setEnabledState(value)
    try {
      if (value) localStorage.setItem(STORAGE_KEY_NOTIFICATIONS_ENABLED, 'true')
      if (!value) localStorage.removeItem(STORAGE_KEY_NOTIFICATIONS_ENABLED)
    } catch {
      // Ignore unavailable storage.
    }

    if (value && !isTauri()) void registerNotificationServiceWorker()
  }, [])

  const sendNotification = useCallback(async (title: string, body: string, data?: NotificationData) => {
    if (!enabledRef.current) return

    if (isTauri()) {
      await sendTauriNotification(title, body, data)
      return
    }

    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const notificationOptions: NotificationOptions = {
      body,
      icon: buildNotificationAssetURL('opencode.svg'),
      tag: data?.sessionID || 'opencode',
      data,
    }

    try {
      const registration = await registerNotificationServiceWorker()
      if (registration) {
        await registration.showNotification(title, notificationOptions)
        return
      }
    } catch {
      // Fall back to the desktop browser Notification API.
    }

    try {
      const notification = new Notification(title, notificationOptions)
      notification.onclick = () => {
        window.focus()
        if (data?.sessionID) window.location.hash = buildNotificationSessionHash(data)
        notification.close()
      }
    } catch {
      // Notification API may be unavailable in this environment.
    }
  }, [])

  return {
    enabled,
    setEnabled,
    permission,
    supported: isTauri() || typeof Notification !== 'undefined',
    sendNotification,
  }
}

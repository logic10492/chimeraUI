// ============================================
// NotificationStore - Toast + 通知历史
// ============================================
//
// 统一管理所有通知：
// 1. Toast 弹窗（右上角，8 秒自动消失，悬停暂停）
// 2. 通知历史（持久化到 localStorage，显示在 Active tab 的 Notifications 区域）
//
// 由 useGlobalEvents 统一推送，不再由 activeSessionStore 管通知

import { useSyncExternalStore } from 'react'
import { serverStore } from './serverStore'

// ============================================
// Types
// ============================================

export type NotificationType = 'permission' | 'question' | 'completed' | 'error'

/** push 后的回调，用于声音播放等扩展 */
export type NotificationPushListener = (type: NotificationType) => void

export interface NotificationEntry {
  id: string
  type: NotificationType
  title: string
  body: string
  sessionId: string
  serverID: string
  directory?: string
  timestamp: number
  read: boolean
}

export interface ToastItem {
  notification: NotificationEntry
  exiting: boolean
}

export interface NotificationPreferencesBackup {
  toastEnabled: boolean
}

interface NotificationState {
  toasts: ToastItem[]
  notifications: NotificationEntry[]
}

type Subscriber = () => void

// ============================================
// Constants
// ============================================

const TOAST_DURATION = 8000
const MAX_TOASTS = 3
const EXIT_ANIMATION_MS = 200
const STORAGE_KEY = 'opencode:notifications'
const TOAST_ENABLED_KEY = 'opencode:toast-enabled'
const MAX_NOTIFICATIONS = 50

// ============================================
// localStorage helpers
// ============================================

function notificationStorageKey(serverID: string) {
  return `srv:${serverID}:${STORAGE_KEY}`
}

function loadNotifications(serverID: string, includeLegacy = false): NotificationEntry[] {
  try {
    const scoped = localStorage.getItem(notificationStorageKey(serverID))
    const legacy = includeLegacy && !scoped ? localStorage.getItem(STORAGE_KEY) : null
    const raw = scoped ?? legacy
    if (!raw) return []
    const entries = (JSON.parse(raw) as Array<Omit<NotificationEntry, 'serverID'> & { serverID?: string }>)
      .slice(0, MAX_NOTIFICATIONS)
      .map(entry => ({ ...entry, serverID: entry.serverID ?? serverID }))
    if (legacy) saveNotifications(serverID, entries)
    return entries
  } catch {
    return []
  }
}

function saveNotifications(serverID: string, entries: NotificationEntry[]) {
  try {
    localStorage.setItem(notificationStorageKey(serverID), JSON.stringify(entries))
  } catch {
    // quota exceeded
  }
}

// ============================================
// Store
// ============================================

class NotificationStore {
  private activeServerID = serverStore.getActiveServerId()
  private state: NotificationState = {
    toasts: [],
    notifications: loadNotifications(this.activeServerID, true),
  }
  private subscribers = new Set<Subscriber>()
  private toastTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pushListeners = new Set<NotificationPushListener>()

  /** toast 弹窗总开关 */
  toastEnabled: boolean = (() => {
    try {
      return localStorage.getItem(TOAST_ENABLED_KEY) !== 'false'
    } catch {
      return true
    }
  })()

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify() {
    this.subscribers.forEach(cb => cb())
  }

  private persist() {
    saveNotifications(this.activeServerID, this.state.notifications)
  }

  getSnapshot = (): NotificationState => this.state

  activateServer(serverID: string) {
    if (this.activeServerID === serverID) return
    this.toastTimers.forEach(timer => clearTimeout(timer))
    this.toastTimers.clear()
    this.activeServerID = serverID
    this.state = {
      toasts: [],
      notifications: loadNotifications(serverID),
    }
    this.notify()
  }

  setToastEnabled(enabled: boolean) {
    this.toastEnabled = enabled
    try {
      localStorage.setItem(TOAST_ENABLED_KEY, String(enabled))
    } catch {
      // Ignore storage write failures.
    }
    // 关闭时清掉当前所有 toast
    if (!enabled) this.dismissAllToasts()
  }

  /** 注册 push 后回调（声音播放等） */
  onPush(listener: NotificationPushListener): () => void {
    this.pushListeners.add(listener)
    return () => this.pushListeners.delete(listener)
  }

  // ============================================
  // 推送通知（加历史 + 弹 toast）
  // ============================================

  push(type: NotificationType, title: string, body: string, sessionId: string, directory?: string) {
    const entry = this.createEntry(type, title, body, sessionId, directory)
    const notifications = [entry, ...this.state.notifications].slice(0, MAX_NOTIFICATIONS)

    this.showToast(entry, notifications)
    this.pushListeners.forEach(fn => {
      try {
        fn(type)
      } catch {
        // 回调异常不影响通知流程
      }
    })
  }

  pushTransient(type: NotificationType, title: string, body: string) {
    if (
      this.state.toasts.some(
        toast =>
          toast.notification.type === type && toast.notification.title === title && toast.notification.body === body,
      )
    ) {
      return
    }
    this.showToast(this.createEntry(type, title, body, ''))
  }

  private createEntry(type: NotificationType, title: string, body: string, sessionId: string, directory?: string) {
    return {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      title,
      body,
      sessionId,
      serverID: this.activeServerID,
      directory,
      timestamp: Date.now(),
      read: false,
    }
  }

  private showToast(entry: NotificationEntry, notifications = this.state.notifications) {
    const includesHistoryUpdate = notifications !== this.state.notifications
    if (!this.toastEnabled) {
      if (includesHistoryUpdate) {
        this.state = { ...this.state, notifications }
        this.persist()
        this.notify()
      }
      return
    }

    const toasts = [...this.state.toasts]
    if (toasts.length >= MAX_TOASTS) {
      const oldest = toasts.pop()
      if (oldest) this.clearToastTimer(oldest.notification.id)
    }
    toasts.unshift({ notification: entry, exiting: false })
    this.state = { ...this.state, toasts, notifications }
    if (includesHistoryUpdate) this.persist()
    this.notify()
    this.scheduleToastDismiss(entry.id)
  }

  // ============================================
  // 用户交互（通知历史）
  // ============================================

  markRead(id: string) {
    const notifications = this.state.notifications.map(n => (n.id === id && !n.read ? { ...n, read: true } : n))
    this.state = { ...this.state, notifications }
    this.persist()
    this.notify()
  }

  markAllRead() {
    const notifications = this.state.notifications.map(n => (n.read ? n : { ...n, read: true }))
    this.state = { ...this.state, notifications }
    this.persist()
    this.notify()
  }

  markSessionNotificationsRead(sessionId: string, type?: NotificationType) {
    let changed = false
    const notifications = this.state.notifications.map(n => {
      if (n.sessionId !== sessionId) return n
      if (type && n.type !== type) return n
      if (n.read) return n
      changed = true
      return { ...n, read: true }
    })
    if (!changed) return
    this.state = { ...this.state, notifications }
    this.persist()
    this.notify()
  }

  dismiss(id: string) {
    const notifications = this.state.notifications.filter(n => n.id !== id)
    this.state = { ...this.state, notifications }
    this.persist()
    this.notify()
  }

  clearAll() {
    this.state = { ...this.state, notifications: [] }
    this.persist()
    this.notify()
  }

  // ============================================
  // Toast 管理
  // ============================================

  private scheduleToastDismiss(id: string) {
    this.clearToastTimer(id)
    const timer = setTimeout(() => this.dismissToast(id), TOAST_DURATION)
    this.toastTimers.set(id, timer)
  }

  private clearToastTimer(id: string) {
    const timer = this.toastTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.toastTimers.delete(id)
    }
  }

  pauseToast(id: string) {
    this.clearToastTimer(id)
  }

  resumeToast(id: string) {
    const exists = this.state.toasts.some(t => t.notification.id === id && !t.exiting)
    if (exists) {
      this.scheduleToastDismiss(id)
    }
  }

  dismissToast(id: string) {
    this.clearToastTimer(id)
    const toasts = this.state.toasts.map(t => (t.notification.id === id ? { ...t, exiting: true } : t))
    this.state = { ...this.state, toasts }
    this.notify()

    setTimeout(() => {
      this.state = {
        ...this.state,
        toasts: this.state.toasts.filter(t => t.notification.id !== id),
      }
      this.notify()
    }, EXIT_ANIMATION_MS)
  }

  dismissAllToasts() {
    this.toastTimers.forEach(timer => clearTimeout(timer))
    this.toastTimers.clear()
    this.state = { ...this.state, toasts: [] }
    this.notify()
  }
}

// ============================================
// 单例 & React Hooks
// ============================================

export const notificationStore = new NotificationStore()

export function exportNotificationPreferencesBackup(): NotificationPreferencesBackup {
  return {
    toastEnabled: notificationStore.toastEnabled,
  }
}

export function importNotificationPreferencesBackup(raw: unknown): void {
  const parsed = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const toastEnabled = typeof parsed?.toastEnabled === 'boolean' ? parsed.toastEnabled : true
  notificationStore.setToastEnabled(toastEnabled)
}

export function useNotificationStore() {
  return useSyncExternalStore(notificationStore.subscribe, notificationStore.getSnapshot)
}

/** 通知历史列表 */
export function useNotifications(): NotificationEntry[] {
  const state = useNotificationStore()
  return state.notifications
}

/** 未读通知数 */
export function useUnreadNotificationCount(): number {
  const state = useNotificationStore()
  return state.notifications.filter(n => !n.read).length
}

/** 未读 completed 通知对应的 sessionId 集合 */
export function useUnreadCompletedSessionIds(): Set<string> {
  const state = useNotificationStore()
  return new Set(state.notifications.filter(n => n.type === 'completed' && !n.read).map(n => n.sessionId))
}

/** 某个 session 是否有未读 completed 通知 */
export function useHasUnreadCompletedNotification(sessionId: string): boolean {
  const unreadCompletedSessionIds = useUnreadCompletedSessionIds()
  return unreadCompletedSessionIds.has(sessionId)
}

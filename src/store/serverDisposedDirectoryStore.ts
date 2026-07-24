// ============================================
// serverDisposedDirectoryStore - 记录被服务器 LRU 驱逐的目录
// ============================================
//
// 服务器 InstanceStore 按 LRU 上限驱逐项目实例并广播
// `server.instance.disposed`。被驱逐的目录在这里标记为“休眠”，
// 自动全量刷新会跳过它们（避免 dispose -> resync -> re-boot 风暴），
// 用户显式切回该目录时清除标记并重新拉取。

import { useSyncExternalStore } from 'react'
import { normalizeToForwardSlash } from '../utils/directoryUtils'
import { serverStore } from './serverStore'

function toKey(serverID: string, directory: string) {
  return `${serverID}\n${normalizeToForwardSlash(directory)}`
}

class ServerDisposedDirectoryStore {
  private disposedAt = new Map<string, number>()
  private listeners = new Set<() => void>()
  private version = 0

  private bump() {
    this.version++
    this.listeners.forEach(listener => listener())
  }

  markDisposed(serverID: string, directory: string) {
    const key = toKey(serverID, directory)
    if (this.disposedAt.has(key)) return
    this.disposedAt.set(key, Date.now())
    this.bump()
  }

  clear(serverID: string, directory: string) {
    if (this.disposedAt.delete(toKey(serverID, directory))) this.bump()
  }

  isDisposed(serverID: string, directory: string): boolean {
    return this.disposedAt.has(toKey(serverID, directory))
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version
}

export const serverDisposedDirectoryStore = new ServerDisposedDirectoryStore()

export function useServerDisposedDirectoryVersion(): number {
  return useSyncExternalStore(serverDisposedDirectoryStore.subscribe, serverDisposedDirectoryStore.getVersion)
}

/** 目录是否处于服务器休眠状态（响应式，供 UI 徽标使用） */
export function useIsServerDisposedDirectory(directory: string | undefined): boolean {
  useServerDisposedDirectoryVersion()
  if (!directory) return false
  return serverDisposedDirectoryStore.isDisposed(serverStore.getActiveServerId(), directory)
}

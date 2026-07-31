// ============================================
// CommandProgressStore - slash 命令执行进度
// ============================================
//
// 数据来源：SSE command.started / command.progress / command.executed 事件
// 按 sessionID 记录正在执行的命令（如 /init-graph）及其 graph 进度
// （phase/current/total/currentFile）。command.executed 到达时清除。

import { useCallback, useSyncExternalStore } from 'react'
import type { CommandProgressPayload, CommandStartedPayload } from '../types/api/event'

export interface CommandProgressEntry {
  sessionId: string
  name: string
  arguments: string
  phase: string
  current: number
  total: number
  currentFile?: string
  elapsedMs: number
  startedAt: number
}

type Subscriber = () => void

class CommandProgressStore {
  private entries = new Map<string, CommandProgressEntry>()
  private subscribers = new Set<Subscriber>()

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify() {
    this.subscribers.forEach(cb => cb())
  }

  started(sessionId: string, data: CommandStartedPayload) {
    this.entries.set(sessionId, {
      sessionId,
      name: data.name,
      arguments: data.arguments,
      phase: 'starting',
      current: 0,
      total: 0,
      elapsedMs: 0,
      startedAt: Date.now(),
    })
    this.notify()
  }

  update(sessionId: string, data: CommandProgressPayload) {
    const existing = this.entries.get(sessionId)
    if (!existing) return
    this.entries.set(sessionId, {
      ...existing,
      phase: data.phase,
      current: Number(data.current),
      total: Number(data.total),
      currentFile: data.currentFile,
      elapsedMs: Number(data.elapsedMs),
    })
    this.notify()
  }

  clear(sessionId: string) {
    if (this.entries.delete(sessionId)) this.notify()
  }

  getEntry(sessionId: string): CommandProgressEntry | undefined {
    return this.entries.get(sessionId)
  }
}

export const commandProgressStore = new CommandProgressStore()

export function useCommandProgress(sessionId: string): CommandProgressEntry | undefined {
  const getSnapshot = useCallback(() => commandProgressStore.getEntry(sessionId), [sessionId])
  return useSyncExternalStore(commandProgressStore.subscribe, getSnapshot)
}

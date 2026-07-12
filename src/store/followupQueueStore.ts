import { useMemo, useSyncExternalStore } from 'react'
import type { Attachment } from '../features/attachment'
import { notificationStore } from './notificationStore'

const STORAGE_PREFIX = 'chimera:followup-queue:v1'
const STORAGE_VERSION = 1

export interface QueuedFollowupDraft {
  id: string
  serverID: string
  sessionId: string
  directory: string
  text: string
  attachments: Attachment[]
  model: {
    providerID: string
    modelID: string
    variant?: string
  }
  variant?: string
  agent?: string
  createdAt: number
}

interface FollowupQueueState {
  itemsBySession: Record<string, QueuedFollowupDraft[] | undefined>
  failedBySession: Record<string, string | undefined>
  sendingBySession: Record<string, string | undefined>
}

interface FollowupQueueStorageSnapshot {
  version: number
  serverID: string
  directory: string
  sessionId: string
  items: QueuedFollowupDraft[]
  failedId?: string
  sendingId?: string
}

const EMPTY_ITEMS: QueuedFollowupDraft[] = []
const EMPTY_STATE = (): FollowupQueueState => ({ itemsBySession: {}, failedBySession: {}, sendingBySession: {} })

function cloneAttachments(attachments: Attachment[]): Attachment[] {
  return attachments.map(attachment => ({
    ...attachment,
    textRange: attachment.textRange ? { ...attachment.textRange } : undefined,
    originalSource: attachment.originalSource
      ? {
          ...attachment.originalSource,
          text: attachment.originalSource.text ? { ...attachment.originalSource.text } : undefined,
          range: attachment.originalSource.range
            ? {
                start: { ...attachment.originalSource.range.start },
                end: attachment.originalSource.range.end ? { ...attachment.originalSource.range.end } : undefined,
              }
            : undefined,
        }
      : undefined,
  }))
}

function storageKey(serverID: string, directory: string, sessionId: string) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(serverID)}:${encodeURIComponent(directory)}:${encodeURIComponent(sessionId)}`
}

function isDraft(value: unknown, snapshot: FollowupQueueStorageSnapshot): value is QueuedFollowupDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<QueuedFollowupDraft>
  return (
    typeof draft.id === 'string' &&
    draft.serverID === snapshot.serverID &&
    draft.sessionId === snapshot.sessionId &&
    draft.directory === snapshot.directory &&
    typeof draft.text === 'string' &&
    Array.isArray(draft.attachments) &&
    !!draft.model &&
    typeof draft.model.providerID === 'string' &&
    typeof draft.model.modelID === 'string' &&
    typeof draft.createdAt === 'number' &&
    Number.isFinite(draft.createdAt)
  )
}

function parseSnapshot(raw: string): FollowupQueueStorageSnapshot {
  const snapshot = JSON.parse(raw) as FollowupQueueStorageSnapshot
  if (
    snapshot.version !== STORAGE_VERSION ||
    typeof snapshot.serverID !== 'string' ||
    typeof snapshot.directory !== 'string' ||
    typeof snapshot.sessionId !== 'string' ||
    !Array.isArray(snapshot.items) ||
    !snapshot.items.every(item => isDraft(item, snapshot)) ||
    (snapshot.failedId !== undefined && typeof snapshot.failedId !== 'string') ||
    (snapshot.sendingId !== undefined && typeof snapshot.sendingId !== 'string')
  ) {
    throw new Error('Unsupported or invalid follow-up queue snapshot')
  }
  return snapshot
}

export class FollowupQueueStore {
  private state: FollowupQueueState = EMPTY_STATE()
  private activeServerID = 'local'
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): FollowupQueueState => this.state

  private emit() {
    this.listeners.forEach(listener => listener())
  }

  private setState(next: FollowupQueueState, sessionId?: string, previousDirectory?: string) {
    this.state = next
    this.emit()
    if (sessionId) this.persistSession(sessionId, previousDirectory)
  }

  private reportStorageError(error: unknown) {
    notificationStore.pushTransient(
      'error',
      'Follow-up queue persistence failed',
      error instanceof Error ? error.message : String(error),
    )
  }

  private persistSession(sessionId: string, previousDirectory?: string) {
    const items = this.state.itemsBySession[sessionId] ?? EMPTY_ITEMS
    const directory = items[0]?.directory ?? previousDirectory
    if (directory === undefined) return
    const serverID = items[0]?.serverID ?? this.activeServerID
    const key = storageKey(serverID, directory, sessionId)

    try {
      if (items.length === 0) {
        localStorage.removeItem(key)
        return
      }
      localStorage.setItem(
        key,
        JSON.stringify({
          version: STORAGE_VERSION,
          serverID,
          directory,
          sessionId,
          items,
          failedId: this.state.failedBySession[sessionId],
          sendingId: this.state.sendingBySession[sessionId],
        } satisfies FollowupQueueStorageSnapshot),
      )
    } catch (error) {
      this.reportStorageError(error)
    }
  }

  activateServer(serverID: string) {
    const next = EMPTY_STATE()
    try {
      const prefix = `${STORAGE_PREFIX}:${encodeURIComponent(serverID)}:`
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
        (key): key is string => !!key?.startsWith(prefix),
      )
      keys.forEach(key => {
        const raw = localStorage.getItem(key)
        if (!raw) return
        const snapshot = parseSnapshot(raw)
        if (snapshot.serverID !== serverID) throw new Error('Follow-up queue server scope mismatch')
        next.itemsBySession[snapshot.sessionId] = snapshot.items.map(item => ({
          ...item,
          attachments: cloneAttachments(item.attachments),
          model: { ...item.model },
        }))
        const failedId = snapshot.failedId ?? snapshot.sendingId
        if (failedId && snapshot.items.some(item => item.id === failedId)) {
          next.failedBySession[snapshot.sessionId] = failedId
        }
      })
    } catch (error) {
      this.activeServerID = serverID
      this.setState(EMPTY_STATE())
      this.reportStorageError(error)
      return
    }

    this.activeServerID = serverID
    this.setState(next)
  }

  enqueue(
    draft: Omit<QueuedFollowupDraft, 'id' | 'createdAt' | 'attachments'> & { attachments: Attachment[] },
  ): QueuedFollowupDraft {
    const queued: QueuedFollowupDraft = {
      ...draft,
      id: `queued_${crypto.randomUUID().replace(/-/g, '')}`,
      createdAt: Date.now(),
      attachments: cloneAttachments(draft.attachments),
      model: { ...draft.model },
    }
    const current = this.state.itemsBySession[queued.sessionId] ?? EMPTY_ITEMS
    this.setState(
      {
        ...this.state,
        itemsBySession: { ...this.state.itemsBySession, [queued.sessionId]: [...current, queued] },
      },
      queued.sessionId,
    )
    return queued
  }

  remove(sessionId: string, id: string) {
    const current = this.state.itemsBySession[sessionId] ?? EMPTY_ITEMS
    if (current.length === 0) return
    const previousDirectory = current[0]?.directory
    const nextItems = current.filter(item => item.id !== id)
    const nextItemsBySession = { ...this.state.itemsBySession }
    if (nextItems.length === 0) delete nextItemsBySession[sessionId]
    else nextItemsBySession[sessionId] = nextItems
    const nextFailedBySession = { ...this.state.failedBySession }
    if (nextFailedBySession[sessionId] === id) delete nextFailedBySession[sessionId]
    const nextSendingBySession = { ...this.state.sendingBySession }
    if (nextSendingBySession[sessionId] === id) delete nextSendingBySession[sessionId]
    this.setState(
      {
        itemsBySession: nextItemsBySession,
        failedBySession: nextFailedBySession,
        sendingBySession: nextSendingBySession,
      },
      sessionId,
      previousDirectory,
    )
  }

  markFailed(sessionId: string, id: string | undefined) {
    const nextFailedBySession = { ...this.state.failedBySession }
    if (!id) delete nextFailedBySession[sessionId]
    else nextFailedBySession[sessionId] = id
    this.setState({ ...this.state, failedBySession: nextFailedBySession }, sessionId)
  }

  clearFailed(sessionId: string) {
    if (!this.state.failedBySession[sessionId]) return
    const nextFailedBySession = { ...this.state.failedBySession }
    delete nextFailedBySession[sessionId]
    this.setState({ ...this.state, failedBySession: nextFailedBySession }, sessionId)
  }

  startSending(sessionId: string, id: string): boolean {
    if (this.state.sendingBySession[sessionId]) return false
    this.setState({ ...this.state, sendingBySession: { ...this.state.sendingBySession, [sessionId]: id } }, sessionId)
    return true
  }

  finishSending(sessionId: string, id: string) {
    if (this.state.sendingBySession[sessionId] !== id) return
    const nextSendingBySession = { ...this.state.sendingBySession }
    delete nextSendingBySession[sessionId]
    this.setState({ ...this.state, sendingBySession: nextSendingBySession }, sessionId)
  }

  getItems(sessionId: string | null): QueuedFollowupDraft[] {
    if (!sessionId) return EMPTY_ITEMS
    return this.state.itemsBySession[sessionId] ?? EMPTY_ITEMS
  }

  getItem(sessionId: string, id: string): QueuedFollowupDraft | undefined {
    return this.getItems(sessionId).find(item => item.id === id)
  }

  clearSession(sessionId: string) {
    const current = this.state.itemsBySession[sessionId] ?? EMPTY_ITEMS
    const hasItems = current.length > 0
    const hasFailed = !!this.state.failedBySession[sessionId]
    const hasSending = !!this.state.sendingBySession[sessionId]
    if (!hasItems && !hasFailed && !hasSending) return
    const nextItemsBySession = { ...this.state.itemsBySession }
    delete nextItemsBySession[sessionId]
    const nextFailedBySession = { ...this.state.failedBySession }
    delete nextFailedBySession[sessionId]
    const nextSendingBySession = { ...this.state.sendingBySession }
    delete nextSendingBySession[sessionId]
    this.setState(
      {
        itemsBySession: nextItemsBySession,
        failedBySession: nextFailedBySession,
        sendingBySession: nextSendingBySession,
      },
      sessionId,
      current[0]?.directory,
    )
  }

  getSessionIds(): string[] {
    return Object.keys(this.state.itemsBySession)
  }

  reset() {
    this.setState(EMPTY_STATE())
  }
}

export const followupQueueStore = new FollowupQueueStore()

export function useFollowupQueue(sessionId: string | null) {
  const state = useSyncExternalStore(followupQueueStore.subscribe, followupQueueStore.getSnapshot)
  return useMemo(
    () => ({
      items: sessionId ? (state.itemsBySession[sessionId] ?? EMPTY_ITEMS) : EMPTY_ITEMS,
      failedId: sessionId ? state.failedBySession[sessionId] : undefined,
      sendingId: sessionId ? state.sendingBySession[sessionId] : undefined,
    }),
    [sessionId, state],
  )
}

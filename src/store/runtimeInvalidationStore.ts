import type { EventScope } from '../types/api/event'

export type RuntimeInvalidation =
  | {
      type: 'file'
      scope: EventScope
      file?: string
      event: 'edited' | 'add' | 'change' | 'unlink' | 'resync' | 'disposed'
    }
  | {
      type: 'lsp'
      scope: EventScope
    }

type Listener = (invalidation: RuntimeInvalidation) => void

class RuntimeInvalidationStore {
  private listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(invalidation: RuntimeInvalidation) {
    this.listeners.forEach(listener => listener(invalidation))
  }
}

export const runtimeInvalidationStore = new RuntimeInvalidationStore()

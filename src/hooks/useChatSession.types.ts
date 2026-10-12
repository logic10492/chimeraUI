import type { RefObject } from 'react'
import type { ModelInfo } from '../types/ui'
import type { ChatAreaHandle } from '../features/chat/ChatArea'

export interface UseChatSessionOptions {
  paneId: string
  chatAreaRef: RefObject<ChatAreaHandle | null>
  currentModel: ModelInfo | undefined
  refetchModels: () => Promise<void>
  sessionId: string | null
  navigateToSession: (sessionId: string, directory?: string) => void
  navigateHome: () => void
}

export interface LiveRetryStatus {
  sessionID: string
  attempt: number
  message: string
  next: number
}
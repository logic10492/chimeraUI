import type { Message, Part, ToolPart, StepFinishPart } from '../../types/message'

export interface MessageRendererProps {
  message: Message
  allowStreamingLayoutAnimation?: boolean
  /** 回合总时长（毫秒），仅在回合最后一条 assistant 消息上有值 */
  turnDuration?: number
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
  canUndo?: boolean
  onEnsureParts?: (messageId: string) => void
}

export interface ForkActionButtonProps {
  message: Message
  onFork?: (message: Message, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
}

export interface UserMessageViewProps {
  message: Message
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => Promise<void> | void
  forkMessageId?: string
  canUndo?: boolean
}

export interface ToolGroupProps {
  parts: ToolPart[]
  stepFinish?: StepFinishPart
  duration?: number
  turnDuration?: number
  isStreaming?: boolean
  agent?: string
  modelLabel?: string
  completedAt?: number
}

export type ToolSummaryCategory =
  | 'execute'
  | 'write'
  | 'edit'
  | 'read'
  | 'search'
  | 'list'
  | 'network'
  | 'task'
  | 'todo'
  | 'question'
  | 'skill'
  | 'think'
  | 'other'

export type ToolSummaryPhase = 'done' | 'active' | 'failed'

export interface SummarySegment {
  text: string
  type: 'normal' | 'error' | 'active'
}

export type RenderItem =
  | { type: 'single'; part: Part }
  | { type: 'reasoning-group'; parts: Extract<Part, { type: 'reasoning' }>[] }
  | { type: 'tool-group'; parts: ToolPart[]; stepFinish?: StepFinishPart }
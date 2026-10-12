import type { DragDropEvent } from '@tauri-apps/api/webview'
import type { Attachment } from '../attachment/types'
import type { Agent as ApiAgent } from '../../types/api/agent'
import type { ModelInfo, FileCapabilities } from '../../types/ui'
import type { ModelSelectorHandle } from './ModelSelector'

export interface HistoryEntry {
  text: string
  attachments: Attachment[]
}

export interface DraggedFileInfo {
  type: 'file' | 'folder'
  path: string
  absolute: string
  name: string
}

export interface DroppedPathInfo {
  type: 'file' | 'folder'
  path: string
  name: string
}

export type TauriDropPosition = Extract<DragDropEvent, { type: 'drop' }>['position']

export interface CollapsedDialogInfo {
  label: string
  queueLength: number
  onExpand: () => void
}

export interface InputBoxProps {
  paneId: string
  onSend: (
    text: string,
    attachments: Attachment[],
    options?: { agent?: string; variant?: string },
  ) => Promise<boolean> | boolean
  onAbort?: () => void
  onCommand?: (command: string) => Promise<boolean> | boolean // 斜杠命令回调，接收完整命令字符串如 "/help"
  onNewChat?: () => void // 新建对话回调
  disabled?: boolean
  isStreaming?: boolean
  agents?: ApiAgent[]
  selectedAgent?: string
  onAgentChange?: (agentName: string) => void
  variants?: string[]
  selectedVariant?: string
  onVariantChange?: (variant: string | undefined) => void
  supportsImages?: boolean // 保留向后兼容（deprecated，优先用 fileCapabilities）
  fileCapabilities?: FileCapabilities
  // Model（移动端 InputToolbar 用）
  models?: ModelInfo[]
  selectedModelKey?: string | null
  onModelChange?: (modelKey: string, model: ModelInfo) => void
  modelsLoading?: boolean
  modelsError?: Error | null
  onModelsRetry?: () => void
  modelSelectorRef?: React.RefObject<ModelSelectorHandle | null>
  rootPath?: string
  sessionId?: string | null
  // Undo/Redo
  revertedText?: string
  revertedAttachments?: Attachment[]
  /** revert 目标消息 id：用于识别同一 revert 目标被重建（引用变化）的场景 */
  revertedMessageId?: string
  canRedo?: boolean
  revertSteps?: number
  onRedo?: () => void
  onRedoAll?: () => void
  onClearRevert?: () => void
  // Animation
  registerInputBox?: (element: HTMLElement | null) => void
  isAtBottom?: boolean
  showScrollToBottom?: boolean
  onScrollToBottom?: () => void
  // Collapsed dialog capsules
  collapsedPermission?: CollapsedDialogInfo
  collapsedQuestion?: CollapsedDialogInfo
}
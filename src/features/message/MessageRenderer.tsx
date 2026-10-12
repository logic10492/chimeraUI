import { memo } from 'react'
import type { MessageRendererProps } from './MessageRenderer.types'
import { UserMessageView } from './MessageRendererUserMessageView'
import { AssistantMessageView } from './MessageRendererAssistantMessageView'

export const MessageRenderer = memo(function MessageRenderer({
  message,
  allowStreamingLayoutAnimation = false,
  turnDuration,
  onUndo,
  onFork,
  forkMessageId,
  canUndo,
  onEnsureParts,
}: MessageRendererProps) {
  const { info } = message
  const isUser = info.role === 'user'

  if (isUser) {
    return (
      <UserMessageView
        message={message}
        onUndo={onUndo}
        onFork={onFork}
        forkMessageId={forkMessageId}
        canUndo={canUndo}
      />
    )
  }

  return (
    <AssistantMessageView
      message={message}
      allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
      turnDuration={turnDuration}
      onFork={onFork}
      forkMessageId={forkMessageId}
      onEnsureParts={onEnsureParts}
    />
  )
})

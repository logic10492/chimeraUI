// ============================================
// useChatMessageSender - 消息发送（含 followup 队列）状态与副作用
// ============================================

import { useCallback, useEffect } from 'react'
import { messageStore } from '../store/messageStore'
import { followupQueueStore } from '../store/followupQueueStore'
import { serverStore } from '../store/serverStore'
import { sendMessageAsync, getSessionMessages } from '../api/message'
import { clearSessionRuntimeState } from '../utils/sessionLifecycle'
import { createErrorHandler } from '../utils'
import type { Attachment } from '../features/attachment/types'
import type { ModelInfo } from '../types/ui'
import type { Session as ApiSession } from '../types/api/session'
import type { RevertHistoryItem } from '../store/messageStoreTypes'
import type { Message as UIMessage } from '../types/message'
import type { QueuedFollowupDraft } from '../store/followupQueueStore'

const handleError = createErrorHandler('session')

export function useChatMessageSender({
  routeSessionId,
  effectiveDirectory,
  currentModel,
  isSessionBusy,
  queuedFollowups,
  queuedFollowupSendingId,
  queuedFollowupFailedId,
  queueFollowupMessages,
  navigateToSession,
  createSession,
  setRestoredContent,
}: {
  routeSessionId: string | null
  effectiveDirectory: string | undefined
  currentModel: ModelInfo | undefined
  isSessionBusy: boolean
  queuedFollowups: QueuedFollowupDraft[]
  queuedFollowupSendingId: string | undefined
  queuedFollowupFailedId: string | undefined
  queueFollowupMessages: boolean
  navigateToSession: (sessionId: string, directory?: string) => void
  createSession: () => Promise<ApiSession>
  setRestoredContent: React.Dispatch<React.SetStateAction<{ sessionId: string; content: RevertHistoryItem } | null>>
}) {
  const buildLocalQueuedMessage = useCallback(
    (input: {
      sessionId: string
      messageId: string
      text: string
      attachments: Attachment[]
      agent?: string
      model: { providerID: string; modelID: string; variant?: string }
      createdAt: number
    }): UIMessage => {
      const parts: UIMessage['parts'] = [
        {
          id: `${input.messageId}:text`,
          type: 'text',
          text: input.text,
          synthetic: false,
          sessionID: input.sessionId,
          messageID: input.messageId,
        },
      ]

      for (const attachment of input.attachments) {
        if (attachment.type === 'agent') {
          parts.push({
            id: attachment.id || `${input.messageId}:agent:${parts.length}`,
            type: 'agent',
            name: attachment.agentName || attachment.displayName,
            source: attachment.textRange
              ? {
                  value: attachment.textRange.value,
                  start: attachment.textRange.start,
                  end: attachment.textRange.end,
                }
              : undefined,
            sessionID: input.sessionId,
            messageID: input.messageId,
          })
          continue
        }

        if (attachment.type !== 'file' && attachment.type !== 'folder') continue

        parts.push({
          id: attachment.id || `${input.messageId}:file:${parts.length}`,
          type: 'file',
          mime: attachment.mime || (attachment.type === 'folder' ? 'application/x-directory' : 'text/plain'),
          filename: attachment.displayName,
          url: attachment.url || '',
          source: attachment.textRange
            ? {
                type: 'file',
                path: attachment.relativePath || attachment.displayName,
                text: {
                  value: attachment.textRange.value,
                  start: attachment.textRange.start,
                  end: attachment.textRange.end,
                },
              }
            : undefined,
          sessionID: input.sessionId,
          messageID: input.messageId,
        })
      }

      return {
        info: {
          id: input.messageId,
          sessionID: input.sessionId,
          role: 'user',
          time: { created: input.createdAt },
          agent: input.agent || '',
          model: input.model,
        },
        parts,
        isStreaming: false,
      }
    },
    [],
  )

  const sendMessageNow = useCallback(
    async (input: {
      sessionId?: string | null
      content: string
      attachments: Attachment[]
      directory: string
      model: { providerID: string; modelID: string }
      options?: { agent?: string; variant?: string }
      allowCreateSession?: boolean
    }) => {
      let sessionId = input.sessionId ?? routeSessionId

      if (sessionId && input.allowCreateSession) {
        const state = messageStore.getSessionState(sessionId)
        if (state?.loadState === 'error' && state.messages.length === 0) {
          clearSessionRuntimeState(sessionId)
          sessionId = null
        }
      }

      let rollbackSnapshot = sessionId ? messageStore.createSendRollbackSnapshot(sessionId) : null

      try {
        if (!sessionId) {
          if (!input.allowCreateSession) return false
          const newSession = await createSession()
          sessionId = newSession.id
          navigateToSession(sessionId, newSession.directory)
        }

        if (rollbackSnapshot) {
          messageStore.truncateAfterRevert(sessionId)
        }

        messageStore.setStreaming(sessionId, true)

        // 记录发送前的消息数量，作为判断 SSE 是否推送新消息的基线
        const msgCountBeforeSend = messageStore.getSessionState(sessionId)?.messages.length ?? 0

        await sendMessageAsync({
          sessionId,
          text: input.content,
          attachments: input.attachments,
          model: input.model,
          agent: input.options?.agent,
          variant: input.options?.variant,
          directory: input.directory,
        })

        // 兜底：等待短暂时间后检查 SSE 是否已推送用户消息，
        // 若未收到则主动拉取补齐，避免 SSE 断流导致用户消息不显示
        const pullSessionId = sessionId
        const pullDir = input.directory
        setTimeout(() => {
          const state = messageStore.getSessionState(pullSessionId)
          if (!state) return
          // 消息数量增加了，说明 SSE 已正常推送
          if (state.messages.length > msgCountBeforeSend) return

          getSessionMessages(pullSessionId, 5, pullDir)
            .then(apiMessages => {
              for (const msg of apiMessages) {
                messageStore.handleMessageUpdated(msg.info)
                if (msg.parts) {
                  for (const part of msg.parts) {
                    messageStore.handlePartUpdated({
                      ...part,
                      sessionID: pullSessionId,
                      messageID: msg.info.id,
                    })
                  }
                }
              }
            })
            .catch(() => {
              // 拉取失败不影响主流程，SSE 重连后仍可补齐
            })
        }, 1500)

        return true
      } catch (error) {
        handleError('send message', error)
        if (sessionId) {
          if (rollbackSnapshot) {
            messageStore.restoreSendRollback(sessionId, rollbackSnapshot)
            rollbackSnapshot = null
          } else {
            messageStore.setStreaming(sessionId, false)
          }
        }

        return false
      }
    },
    [routeSessionId, navigateToSession, createSession],
  )

  // Send message handler
  const handleSend = useCallback(
    async (content: string, attachments: Attachment[], options?: { agent?: string; variant?: string }) => {
      if (!currentModel) {
        handleError('send message', new Error('No model selected'))
        return false
      }

      // 如果队列头有失败项，用户重新发送时先清掉失败项（内容已恢复到输入框）
      if (routeSessionId && queuedFollowupFailedId) {
        followupQueueStore.remove(routeSessionId, queuedFollowupFailedId)
      }

      const shouldQueueFollowup =
        !!routeSessionId && (queuedFollowups.length > 0 || (queueFollowupMessages && isSessionBusy))

      if (shouldQueueFollowup) {
        const queued = followupQueueStore.enqueue({
          serverID: serverStore.getActiveServerId(),
          sessionId: routeSessionId,
          directory: effectiveDirectory || '',
          text: content,
          attachments,
          model: {
            providerID: currentModel.providerId,
            modelID: currentModel.id,
            variant: options?.variant,
          },
          variant: options?.variant,
          agent: options?.agent,
        })
        messageStore.upsertLocalMessage(
          buildLocalQueuedMessage({
            sessionId: queued.sessionId,
            messageId: queued.id,
            text: queued.text,
            attachments: queued.attachments,
            agent: queued.agent,
            model: queued.model,
            createdAt: queued.createdAt,
          }),
        )
        return true
      }

      return sendMessageNow({
        sessionId: routeSessionId,
        content,
        attachments,
        model: {
          providerID: currentModel.providerId,
          modelID: currentModel.id,
        },
        options,
        directory: effectiveDirectory || '',
        allowCreateSession: true,
      })
    },
    [
      currentModel,
      routeSessionId,
      queuedFollowups.length,
      queuedFollowupFailedId,
      queueFollowupMessages,
      isSessionBusy,
      effectiveDirectory,
      buildLocalQueuedMessage,
      sendMessageNow,
    ],
  )

  const sendQueuedFollowup = useCallback(
    async (draftId: string, sessionId: string) => {
      const draft = followupQueueStore.getItem(sessionId, draftId)
      if (!draft) return false
      if (!followupQueueStore.startSending(draft.sessionId, draft.id)) return false

      // 发送前先移除占位消息，让 sendMessageNow 走和正常发送完全一样的路径
      messageStore.removeMessage(draft.sessionId, draft.id)

      const ok = await sendMessageNow({
        sessionId: draft.sessionId,
        content: draft.text,
        attachments: draft.attachments,
        model: {
          providerID: draft.model.providerID,
          modelID: draft.model.modelID,
        },
        options: {
          agent: draft.agent,
          variant: draft.variant,
        },
        directory: draft.directory,
      })

      followupQueueStore.finishSending(draft.sessionId, draft.id)

      if (ok) {
        followupQueueStore.remove(draft.sessionId, draft.id)
      } else {
        // 标记失败，阻塞后续队列项
        followupQueueStore.markFailed(draft.sessionId, draft.id)
        // 移除剩余排队消息的本地占位，恢复队头到输入框
        const remaining = followupQueueStore.getItems(draft.sessionId)
        for (const item of remaining) {
          messageStore.removeMessage(draft.sessionId, item.id)
        }
        setRestoredContent({
          sessionId: draft.sessionId,
          content: {
            messageId: draft.id,
            text: draft.text,
            attachments: draft.attachments,
            model: draft.model,
            variant: draft.variant ?? draft.model.variant,
            agent: draft.agent,
          },
        })
      }

      return ok
    },
    [sendMessageNow],
  )

  useEffect(() => {
    if (!routeSessionId) return

    const nextQueued = queuedFollowups[0]
    if (!nextQueued) return
    if (queuedFollowupSendingId) return
    if (queuedFollowupFailedId) return
    if (isSessionBusy) return

    void sendQueuedFollowup(nextQueued.id, routeSessionId)
  }, [
    routeSessionId,
    queuedFollowups,
    queuedFollowupSendingId,
    queuedFollowupFailedId,
    isSessionBusy,
    sendQueuedFollowup,
  ])

  return { handleSend }
}
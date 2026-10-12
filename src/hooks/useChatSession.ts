// ============================================
// useChatSession - 聊天会话管理
// ============================================

import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { messageStore } from '../store/messageStore'
import { useSessionFamily } from '../store/childSessionStore'
import { useSessionState } from '../store/messageStoreHooks'
import { autoApproveStore } from '../store/autoApproveStore'
import { useActiveSessionStore } from '../store/activeSessionStore'
import type { RevertHistoryItem } from '../store/messageStoreTypes'
import { useSessionManager } from './useSessionManager'
import { hasOtherConsumerForSession } from './useGlobalEvents'
import { usePermissions } from './usePermissions'
import { usePermissionHandler } from './usePermissionHandler'
import { useMessageAnimation } from './useMessageAnimation'
import { useDirectory } from '../contexts/useDirectory'
import { useSessionContext } from '../contexts/useSessionContext'
import { extractUserMessageContent } from '../api/message'
import { abortSession, summarizeSession, forkSession } from '../api/session'
import { prefetchCommands, executeCommand } from '../api/command'
import { prefetchRootDirectory } from '../api/file'
import { getMessageText, isUserMessage, type AssistantMessageInfo, type Message as UIMessage } from '../types/message'
import { clipboardErrorHandler, copyTextToClipboard, createErrorHandler } from '../utils'
import { clearSessionRuntimeState } from '../utils/sessionLifecycle'
import { followupQueueStore, useFollowupQueue } from '../store/followupQueueStore'
import { themeStore } from '../store/themeStore'
import type { UseChatSessionOptions, LiveRetryStatus } from './useChatSession.types'
import { EMPTY_SESSION_STATE } from './useChatSession.utils'
import { useChatSessionAgents } from './useChatSessionAgents'
import { useSessionPermissionAutoApprove } from './useSessionPermissionAutoApprove'
import { useSessionSseConsumer } from './useSessionSseConsumer'
import { useSessionPermissionBootstrap } from './useSessionPermissionBootstrap'
import { useChatMessageSender } from './useChatMessageSender'
import { useSessionNavigation } from './useSessionNavigation'

const handleError = createErrorHandler('session')

export function useChatSession({
  paneId,
  chatAreaRef,
  currentModel,
  refetchModels,
  sessionId: routeSessionId,
  navigateToSession,
  navigateHome,
}: UseChatSessionOptions) {
  const { statusMap } = useActiveSessionStore()
  const { queueFollowupMessages } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)

  const [restoredContent, setRestoredContent] = useState<{ sessionId: string; content: RevertHistoryItem } | null>(null)

  // Hooks
  const { resetPermissions } = usePermissions()
  const { currentDirectory } = useDirectory()
  const { createSession, sessions } = useSessionContext()

  // Agents
  const { agents, setAgents, selectedAgent, setSelectedAgent, handleToggleAgent, restoreAgentFromMessage } =
    useChatSessionAgents(paneId, currentDirectory)

  const routeStatus = routeSessionId ? statusMap[routeSessionId] : undefined
  const routeSessionIdRef = useRef(routeSessionId)

  useEffect(() => {
    routeSessionIdRef.current = routeSessionId
  }, [routeSessionId])

  const handleMissingRouteSession = useCallback(
    (missingSessionId: string) => {
      if (routeSessionIdRef.current !== missingSessionId) return
      clearSessionRuntimeState(missingSessionId)
      navigateHome()
    },
    [navigateHome],
  )

  const {
    items: queuedFollowups,
    sendingId: queuedFollowupSendingId,
    failedId: queuedFollowupFailedId,
  } = useFollowupQueue(routeSessionId)

  const perSessionStateRaw = useSessionState(routeSessionId)
  const perSessionState = perSessionStateRaw ?? EMPTY_SESSION_STATE

  const messages = perSessionState.messages
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const isStreaming = perSessionState.isStreaming
  const sessionDirectory = perSessionState.directory
  const canUndo = perSessionState.canUndo
  const canRedo = perSessionState.canRedo
  const redoSteps = perSessionState.redoSteps
  const revertedContent = perSessionState.revertedContent
  const hasMoreHistory = perSessionState.hasMoreHistory
  const loadState = routeSessionId ? perSessionState.loadState : ('idle' as const)
  const loadError = routeSessionId ? perSessionState.loadError : undefined

  // OpenAPI SessionStatus.retry: { attempt, message, next }
  const retryStatus = useMemo<LiveRetryStatus | null>(() => {
    if (!routeSessionId || routeStatus?.type !== 'retry') return null
    return {
      sessionID: routeSessionId,
      attempt: routeStatus.attempt,
      message: routeStatus.message,
      next: routeStatus.next,
    }
  }, [routeSessionId, routeStatus])

  const isSessionBusy = useMemo(() => Boolean(routeStatus) || isStreaming, [routeStatus, isStreaming])

  // Session family for permission polling
  const sessionFamily = useSessionFamily(routeSessionId)

  // Session Manager
  const { loadSession, loadMoreHistory, handleUndo, handleRedo, handleRedoAll, clearRevert } = useSessionManager({
    sessionId: routeSessionId,
    directory: currentDirectory,
    onSessionMissing: handleMissingRouteSession,
  })

  // Permission handling
  const {
    pendingPermissionRequests,
    pendingQuestionRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
    handlePermissionReply,
    handleQuestionReply,
    handleQuestionReject,
    refreshPendingRequests,
    resetPendingRequests,
    isReplying,
  } = usePermissionHandler()

  // Message animations
  const { registerMessage, registerInputBox, animateUndo, animateRedo } = useMessageAnimation()

  // Effective directory (used in multiple places)
  const effectiveDirectory = sessionDirectory || currentDirectory

  const fullAutoMode = useSyncExternalStore(
    cb => autoApproveStore.onFullAutoChange(cb),
    () => autoApproveStore.getPaneFullAutoMode(paneId),
  )
  const approvePendingOnFullAuto = useSyncExternalStore(
    autoApproveStore.subscribe,
    () => autoApproveStore.approvePendingOnFullAuto,
  )

  const replyPermissionOnceAutomatically = useSessionPermissionAutoApprove({
    routeSessionId,
    effectiveDirectory,
    sessionFamily,
    fullAutoMode,
    approvePendingOnFullAuto,
    pendingPermissionRequests,
    handlePermissionReply,
    setPendingPermissionRequests,
    refreshPendingRequests,
  })

  // ============================================
  // SSE 事件回调（permission / question / scroll / idle / error / reconnect）
  // ============================================
  useSessionSseConsumer({
    paneId,
    routeSessionId,
    effectiveDirectory,
    sessionFamily,
    currentDirectory,
    chatAreaRef,
    replyPermissionOnceAutomatically,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
    setAgents,
    loadSession,
    refreshPendingRequests,
    refetchModels,
  })

  const handleVisibleMessageIdsChange = useCallback((_ids: string[]) => {
    // No-op: parts are always in memory now
  }, [])

  // Preload @ root directory and / commands for current session directory
  useEffect(() => {
    if (!routeSessionId || !effectiveDirectory) return

    prefetchRootDirectory(effectiveDirectory).catch(() => {})
    prefetchCommands(effectiveDirectory).catch(() => {})
  }, [routeSessionId, effectiveDirectory])

  // Load child sessions and pending permissions on session change
  useSessionPermissionBootstrap({
    routeSessionId,
    effectiveDirectory,
    sessionDirectory,
    resetPendingRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
  })

  // Send message handler (with followup queue)
  const { handleSend } = useChatMessageSender({
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
  })

  // New chat handler
  const handleNewChat = useCallback(() => {
    if (routeSessionId) {
      followupQueueStore.clearSession(routeSessionId)
      if (!hasOtherConsumerForSession(routeSessionId, paneId)) {
        messageStore.clearSession(routeSessionId)
      }
    }
    resetPermissions()
    resetPendingRequests()
  }, [routeSessionId, paneId, resetPermissions, resetPendingRequests])

  const handleForkMessage = useCallback(
    async (message: UIMessage, forkMessageId?: string) => {
      const targetMessageId = forkMessageId || message.info.id

      try {
        if (message.info.role === 'assistant') {
          const assistantInfo = message.info as AssistantMessageInfo
          // 后端 fork 语义：messageID 指定的消息**不包含**在新 session 里。
          // 要保留这条 assistant 回复，需要传它之后的下一条用户消息 ID；
          // 如果它已经是最末尾，不传 messageID，fork 整个 session。
          const currentMessages = messagesRef.current
          const idx = currentMessages.findIndex(m => m.info.id === targetMessageId)
          let forkAtMessageId: string | undefined
          if (idx >= 0) {
            for (let i = idx + 1; i < currentMessages.length; i++) {
              if (currentMessages[i].info.role === 'user') {
                forkAtMessageId = currentMessages[i].info.id
                break
              }
            }
          }
          const forkedSession = await forkSession(assistantInfo.sessionID, forkAtMessageId, effectiveDirectory)
          setRestoredContent(null)
          navigateToSession(forkedSession.id, forkedSession.directory)
          return
        }

        if (message.info.role !== 'user') return

        if (!isUserMessage(message.info)) return

        const userInfo = message.info
        const content = extractUserMessageContent(message)
        const forkedSession = await forkSession(userInfo.sessionID, targetMessageId, effectiveDirectory)

        setRestoredContent({
          sessionId: forkedSession.id,
          content: {
            messageId: userInfo.id,
            text: content.text,
            attachments: content.attachments,
            model: userInfo.model,
            variant: userInfo.model.variant,
            agent: userInfo.agent,
          },
        })

        navigateToSession(forkedSession.id, forkedSession.directory)
      } catch (error) {
        handleError('fork session', error)
      }
    },
    [effectiveDirectory, navigateToSession],
  )

  // Abort handler
  const handleAbort = useCallback(async () => {
    if (!routeSessionId) return
    try {
      const directory = sessionDirectory || currentDirectory
      await abortSession(routeSessionId, directory)
      messageStore.handleSessionIdle(routeSessionId)
    } catch (error) {
      handleError('abort session', error)
    }
  }, [routeSessionId, sessionDirectory, currentDirectory])

  // Command handler (slash commands)
  const handleCommand = useCallback(
    async (commandStr: string) => {
      // 解析命令："/help arg1 arg2" => command="help", args="arg1 arg2"
      const trimmed = commandStr.trim()
      const withoutSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
      const spaceIndex = withoutSlash.indexOf(' ')
      const command = spaceIndex > 0 ? withoutSlash.slice(0, spaceIndex) : withoutSlash
      const args = spaceIndex > 0 ? withoutSlash.slice(spaceIndex + 1) : ''

      if (!command) return false

      if (command === 'new') {
        navigateHome()
        handleNewChat()
        return true
      }

      let sessionId = routeSessionId

      try {
        if (sessionId) {
          const state = messageStore.getSessionState(sessionId)
          if (state?.loadState === 'error' && state.messages.length === 0) {
            clearSessionRuntimeState(sessionId)
            sessionId = null
          }
        }

        // Create session if needed (like handleSend does)
        if (!sessionId) {
          const newSession = await createSession()
          sessionId = newSession.id
          navigateToSession(sessionId, newSession.directory)
        }

        if (command === 'compact') {
          if (!currentModel) {
            handleError('execute command', new Error('No model selected'))
            return false
          }

          // Commands should count as sent once they are accepted for execution.
          // Do not keep the draft alive until the long-running compaction finishes.
          void summarizeSession(
            sessionId,
            { providerID: currentModel.providerId, modelID: currentModel.id },
            effectiveDirectory,
          ).catch(err => {
            handleError('execute command', err)
          })

          return true
        }

        // Keep command submission semantics aligned with normal messages:
        // once the command is dispatched, clear the draft immediately.
        void executeCommand(sessionId, command, args, effectiveDirectory).catch(err => {
          handleError('execute command', err)
        })

        return true
      } catch (err) {
        handleError('execute command', err)
        return false
      }
    },
    [routeSessionId, effectiveDirectory, createSession, navigateToSession, currentModel, navigateHome, handleNewChat],
  )

  // Undo with animation
  const handleUndoWithAnimation = useCallback(
    async (userMessageId: string) => {
      const currentMessages = messagesRef.current
      const messageIndex = currentMessages.findIndex(m => m.info.id === userMessageId)
      if (messageIndex === -1) return

      const messageIdsToRemove = currentMessages.slice(messageIndex).map(m => m.info.id)

      await animateUndo(messageIdsToRemove)
      await handleUndo(userMessageId)
    },
    [animateUndo, handleUndo],
  )

  // Redo with animation
  const handleRedoWithAnimation = useCallback(async () => {
    await animateRedo()
    await handleRedo()
  }, [animateRedo, handleRedo])

  // Session selection / new session / archive / prev / next
  const { handleSelectSession, handleNewSession, handleArchiveSession, handlePreviousSession, handleNextSession } =
    useSessionNavigation({
      routeSessionId,
      sessions,
      effectiveDirectory,
      navigateToSession,
      navigateHome,
      handleNewChat,
    })

  // Copy last AI response to clipboard
  const handleCopyLastResponse = useCallback(async () => {
    const lastAssistant = [...messages].reverse().find(m => m.info.role === 'assistant')
    if (!lastAssistant) return

    const text = getMessageText(lastAssistant)
    if (text) {
      try {
        await copyTextToClipboard(text)
      } catch (err) {
        clipboardErrorHandler('copy last response', err)
      }
    }
  }, [messages])

  const clearRestoredContent = useCallback(() => {
    setRestoredContent(null)
    clearRevert()
  }, [clearRevert])

  const activeRestoredContent = useMemo(() => {
    if (!restoredContent || restoredContent.sessionId !== routeSessionId) return null
    return restoredContent.content
  }, [restoredContent, routeSessionId])

  return {
    // State
    messages,
    isStreaming,
    sessionDirectory,
    canUndo,
    canRedo,
    redoSteps,
    revertedContent,
    restoredContent: activeRestoredContent,
    loadState,
    loadError,
    hasMoreHistory,
    retryStatus,
    agents,
    selectedAgent,
    setSelectedAgent,
    routeSessionId,
    effectiveDirectory,

    // Permissions
    pendingPermissionRequests,
    pendingQuestionRequests,
    queuedFollowups,
    queuedFollowupSendingId,
    handlePermissionReply,
    handleQuestionReply,
    handleQuestionReject,
    isReplying,

    // Session management
    loadMoreHistory,
    handleRedoAll,
    clearRevert: clearRestoredContent,

    // Animation
    registerMessage,
    registerInputBox,

    // Handlers
    handleSend,
    handleAbort,
    handleCommand,
    handleUndoWithAnimation,
    handleRedoWithAnimation,
    handleForkMessage,
    handleSelectSession,
    handleNewSession,
    handleVisibleMessageIdsChange,
    handleArchiveSession,
    handlePreviousSession,
    handleNextSession,
    handleToggleAgent,
    handleCopyLastResponse,
    restoreAgentFromMessage,
  }
}
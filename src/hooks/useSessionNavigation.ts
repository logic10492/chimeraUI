// ============================================
// useSessionNavigation - session 选择 / 新建 / 归档 / 前后切换
// ============================================

import { useCallback } from 'react'
import { updateSession } from '../api/session'
import { createErrorHandler } from '../utils'
import type { Session as ApiSession } from '../types/api/session'

const handleError = createErrorHandler('session')

export function useSessionNavigation({
  routeSessionId,
  sessions,
  effectiveDirectory,
  navigateToSession,
  navigateHome,
  handleNewChat,
}: {
  routeSessionId: string | null
  sessions: ApiSession[]
  effectiveDirectory: string | undefined
  navigateToSession: (sessionId: string, directory?: string) => void
  navigateHome: () => void
  handleNewChat: () => void
}) {
  // Session selection
  const handleSelectSession = useCallback(
    (session: ApiSession) => {
      navigateToSession(session.id, session.directory)
    },
    [navigateToSession],
  )

  // New session
  const handleNewSession = useCallback(() => {
    navigateHome()
    handleNewChat()
  }, [navigateHome, handleNewChat])

  // Archive current session
  const handleArchiveSession = useCallback(async () => {
    if (!routeSessionId) return
    try {
      await updateSession(routeSessionId, { time: { archived: Date.now() } }, effectiveDirectory)
      navigateHome()
      handleNewChat()
    } catch (error) {
      handleError('archive session', error)
    }
  }, [routeSessionId, effectiveDirectory, navigateHome, handleNewChat])

  // Navigate to previous session
  const handlePreviousSession = useCallback(() => {
    if (!sessions.length) return
    const currentIndex = sessions.findIndex(s => s.id === routeSessionId)
    if (currentIndex > 0) {
      const target = sessions[currentIndex - 1]
      navigateToSession(target.id, target.directory)
    } else if (currentIndex === -1 && sessions.length > 0) {
      // Not in any session, go to first
      navigateToSession(sessions[0].id, sessions[0].directory)
    }
  }, [sessions, routeSessionId, navigateToSession])

  // Navigate to next session
  const handleNextSession = useCallback(() => {
    if (!sessions.length) return
    const currentIndex = sessions.findIndex(s => s.id === routeSessionId)
    if (currentIndex >= 0 && currentIndex < sessions.length - 1) {
      const target = sessions[currentIndex + 1]
      navigateToSession(target.id, target.directory)
    }
  }, [sessions, routeSessionId, navigateToSession])

  return { handleSelectSession, handleNewSession, handleArchiveSession, handlePreviousSession, handleNextSession }
}
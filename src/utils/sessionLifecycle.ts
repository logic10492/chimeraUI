import { activeSessionStore } from '../store/activeSessionStore'
import { childSessionStore } from '../store/childSessionStore'
import { followupQueueStore } from '../store/followupQueueStore'
import { messageStore } from '../store/messageStore'
import { todoStore } from '../store/todoStore'

export function clearSessionRuntimeState(sessionId: string, serverID?: string) {
  const sessionIds = childSessionStore.getSessionAndDescendants(sessionId)

  for (const id of sessionIds) {
    messageStore.clearSession(id)
    followupQueueStore.clearSession(id)
    todoStore.clearTodos(id)
    activeSessionStore.removeSession(id, serverID)
  }

  childSessionStore.removeSession(sessionId)
  // 子会话关系移除后对账活跃区（running 后代消失时补入待查看留存）
  activeSessionStore.reconcileChildSessions()
}

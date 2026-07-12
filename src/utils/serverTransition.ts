import { invalidateAllRootDirectoryCaches } from '../api/file'
import { activeSessionStore } from '../store/activeSessionStore'
import { followupQueueStore } from '../store/followupQueueStore'
import { layoutStore } from '../store/layoutStore'
import { notificationStore } from '../store/notificationStore'
import { paneLayoutStore } from '../store/paneLayoutStore'
import { runtimeInvalidationStore } from '../store/runtimeInvalidationStore'

export function resetServerScopedRuntime(serverID: string) {
  invalidateAllRootDirectoryCaches()
  activeSessionStore.resetRuntimeState()
  notificationStore.activateServer(serverID)
  paneLayoutStore.activateServer(serverID)
  followupQueueStore.activateServer(serverID)
  layoutStore.syncTerminalSessions(undefined, [])

  const scope = { serverID, directory: 'global' }
  runtimeInvalidationStore.emit({ type: 'file', scope, event: 'resync' })
  runtimeInvalidationStore.emit({ type: 'lsp', scope })
}

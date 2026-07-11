import { activeSessionStore } from '../store/activeSessionStore'
import { serverStore } from '../store/serverStore'
import type { Session } from '../types/api/session'
import { formatPathForApi } from '../utils/directoryUtils'

export interface ApiScope {
  serverID: string
  directory?: string
  workspace?: string
}

export type ApiScopeInput = ApiScope | string | undefined

export function activeApiScope(directory?: string, workspace?: string): ApiScope {
  return resolveApiScope({ serverID: serverStore.getActiveServerId(), directory, workspace })
}

export function resolveApiScope(input?: ApiScopeInput): ApiScope {
  if (typeof input === 'string' || input === undefined) {
    return { serverID: serverStore.getActiveServerId(), directory: formatPathForApi(input) }
  }
  if (input.workspace) return { serverID: input.serverID, workspace: input.workspace }
  return { serverID: input.serverID, directory: formatPathForApi(input.directory) }
}

export function apiScopeQuery(scope: ApiScope): { directory?: string } | { workspace: string } {
  if (scope.workspace) return { workspace: scope.workspace }
  return { directory: formatPathForApi(scope.directory) }
}

export function apiScopeKey(scope: ApiScope): string {
  return JSON.stringify([
    scope.serverID,
    scope.workspace ? 'workspace' : 'directory',
    scope.workspace ?? scope.directory ?? '',
  ])
}

export function resolveSessionApiScope(sessionId: string, input?: ApiScopeInput): ApiScope {
  const fallback = resolveApiScope(input)
  const hasExplicitServer = typeof input === 'object'
  if (!hasExplicitServer && activeSessionStore.getSessionMetaServerIDs(sessionId).length > 1) {
    throw new Error(`Session ${sessionId} exists on multiple servers; pass an explicit ApiScope`)
  }

  const meta = activeSessionStore.getSessionMeta(sessionId, hasExplicitServer ? fallback.serverID : undefined)
  if (!meta) return fallback

  if (meta.workspaceID) return { serverID: meta.serverID, workspace: meta.workspaceID }
  return { serverID: meta.serverID, directory: formatPathForApi(meta.directory ?? fallback.directory) }
}

export function rememberSessionApiScope(session: Session, input?: ApiScopeInput) {
  const scope = resolveApiScope(input)
  activeSessionStore.setSessionMeta(
    session.id,
    session.title,
    session.directory ?? scope.directory,
    scope.serverID,
    session.workspaceID ?? scope.workspace,
  )
}

export function rememberSessionApiScopes(sessions: Session[], input?: ApiScopeInput) {
  const scope = resolveApiScope(input)
  activeSessionStore.setSessionMetaBulk(
    sessions.map(session => ({
      sessionId: session.id,
      title: session.title,
      directory: session.directory ?? scope.directory,
      serverID: scope.serverID,
      workspaceID: session.workspaceID ?? scope.workspace,
    })),
  )
}

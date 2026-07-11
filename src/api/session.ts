// ============================================
// Session API Functions
// 基于 @opencode-ai/sdk: /session 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import {
  activeApiScope,
  apiScopeQuery,
  rememberSessionApiScope,
  rememberSessionApiScopes,
  resolveApiScope,
  resolveSessionApiScope,
  type ApiScope,
  type ApiScopeInput,
} from './scope'
import { normalizeTodoItems } from './todo'
import { normalizeFileDiffs } from '../types/api/file'
import type { ApiSession, SessionListParams, FileDiff, WorkBrief } from './types'
import type { SessionStatusMap } from '../types/api/session'
import type { TodoItem } from '../types/api/event'

function normalizeSessionList(value: unknown): ApiSession[] {
  if (Array.isArray(value)) return value as ApiSession[]
  throw new Error('Invalid OpenCode session list response')
}

function scopedSession(session: ApiSession, scope: ApiScope): ApiSession {
  rememberSessionApiScope(session, scope)
  return session
}

// ============================================
// Session Status & Diff
// ============================================

/**
 * 获取所有 session 的当前状态
 */
export async function getSessionStatus(input?: ApiScopeInput): Promise<SessionStatusMap> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).session.status(apiScopeQuery(scope)))
}

export async function getSessionWorkBrief(sessionId: string, input?: ApiScopeInput): Promise<WorkBrief> {
  const scope = resolveSessionApiScope(sessionId, input)
  return unwrap(await getSDKClient(scope).session.workBrief({ sessionID: sessionId, ...apiScopeQuery(scope) }))
}

/**
 * 获取 session 的 diff
 * 返回可在 UI 中渲染的 SnapshotFileDiff（过滤缺少 file 的异常项）
 */
export async function getSessionDiff(
  sessionId: string,
  input?: ApiScopeInput,
  options?: { messageId?: string },
): Promise<FileDiff[]> {
  const scope = resolveSessionApiScope(sessionId, input)
  return normalizeFileDiffs(
    unwrap(
      await getSDKClient(scope).session.diff({
        sessionID: sessionId,
        ...apiScopeQuery(scope),
        messageID: options?.messageId,
      }),
    ),
  )
}

/**
 * 获取当前可见用户消息对应的本轮 diff
 */
export async function getLastTurnDiff(sessionId: string, input?: ApiScopeInput): Promise<FileDiff[]> {
  return getSessionDiff(sessionId, input)
}

// ============================================
// Session CRUD
// ============================================

/**
 * 获取 session 列表
 */
export async function getSessions(params: SessionListParams & { apiScope?: ApiScope } = {}): Promise<ApiSession[]> {
  const { apiScope, directory, workspace, ...query } = params
  const scope = apiScope ? resolveApiScope(apiScope) : activeApiScope(directory, workspace)
  const sessions = normalizeSessionList(
    unwrap(
      await getSDKClient(scope).session.list({
        ...apiScopeQuery(scope),
        ...query,
      }),
    ),
  )
  rememberSessionApiScopes(sessions, scope)
  return sessions
}

/**
 * 获取单个 session
 */
export async function getSession(sessionId: string, input?: ApiScopeInput): Promise<ApiSession> {
  const scope = resolveSessionApiScope(sessionId, input)
  return scopedSession(
    unwrap(await getSDKClient(scope).session.get({ sessionID: sessionId, ...apiScopeQuery(scope) })),
    scope,
  )
}

/**
 * 创建 session
 */
export async function createSession(
  params: {
    directory?: string
    workspace?: string
    apiScope?: ApiScope
    title?: string
    parentID?: string
  } = {},
): Promise<ApiSession> {
  const { directory, workspace, apiScope, title, parentID } = params
  const scope = apiScope ? resolveApiScope(apiScope) : activeApiScope(directory, workspace)
  return scopedSession(
    unwrap(
      await getSDKClient(scope).session.create({
        ...apiScopeQuery(scope),
        title,
        parentID,
      }),
    ),
    scope,
  )
}

/**
 * 更新 session
 */
export async function updateSession(
  sessionId: string,
  params: { title?: string; time?: { archived?: number } },
  input?: ApiScopeInput,
): Promise<ApiSession> {
  const scope = resolveSessionApiScope(sessionId, input)
  return scopedSession(
    unwrap(
      await getSDKClient(scope).session.update({
        sessionID: sessionId,
        ...apiScopeQuery(scope),
        ...params,
      }),
    ),
    scope,
  )
}

/**
 * 删除 session
 */
export async function deleteSession(sessionId: string, input?: ApiScopeInput): Promise<boolean> {
  const scope = resolveSessionApiScope(sessionId, input)
  unwrap(await getSDKClient(scope).session.delete({ sessionID: sessionId, ...apiScopeQuery(scope) }))
  return true
}

// ============================================
// Session Actions
// ============================================

/**
 * 中止 session
 */
export async function abortSession(sessionId: string, input?: ApiScopeInput): Promise<boolean> {
  const scope = resolveSessionApiScope(sessionId, input)
  unwrap(await getSDKClient(scope).session.abort({ sessionID: sessionId, ...apiScopeQuery(scope) }))
  return true
}

/**
 * 回退消息
 */
export async function revertMessage(
  sessionId: string,
  messageId: string,
  partId?: string,
  input?: ApiScopeInput,
): Promise<ApiSession> {
  const scope = resolveSessionApiScope(sessionId, input)
  return scopedSession(
    unwrap(
      await getSDKClient(scope).session.revert({
        sessionID: sessionId,
        ...apiScopeQuery(scope),
        messageID: messageId,
        partID: partId,
      }),
    ),
    scope,
  )
}

/**
 * 恢复已回退的消息
 */
export async function unrevertSession(sessionId: string, input?: ApiScopeInput): Promise<ApiSession> {
  const scope = resolveSessionApiScope(sessionId, input)
  return scopedSession(
    unwrap(await getSDKClient(scope).session.unrevert({ sessionID: sessionId, ...apiScopeQuery(scope) })),
    scope,
  )
}

/**
 * 分享 session
 */
export async function shareSession(sessionId: string, input?: ApiScopeInput): Promise<ApiSession> {
  const scope = resolveSessionApiScope(sessionId, input)
  return scopedSession(
    unwrap(await getSDKClient(scope).session.share({ sessionID: sessionId, ...apiScopeQuery(scope) })),
    scope,
  )
}

/**
 * 取消分享 session
 */
export async function unshareSession(sessionId: string, input?: ApiScopeInput): Promise<ApiSession> {
  const scope = resolveSessionApiScope(sessionId, input)
  return scopedSession(
    unwrap(await getSDKClient(scope).session.unshare({ sessionID: sessionId, ...apiScopeQuery(scope) })),
    scope,
  )
}

/**
 * Fork session
 */
export async function forkSession(sessionId: string, messageId?: string, input?: ApiScopeInput): Promise<ApiSession> {
  const scope = resolveSessionApiScope(sessionId, input)
  return scopedSession(
    unwrap(
      await getSDKClient(scope).session.fork({
        sessionID: sessionId,
        ...apiScopeQuery(scope),
        messageID: messageId,
      }),
    ),
    scope,
  )
}

/**
 * 总结 session
 */
export async function summarizeSession(
  sessionId: string,
  params: { providerID: string; modelID: string; auto?: boolean },
  input?: ApiScopeInput,
): Promise<boolean> {
  const scope = resolveSessionApiScope(sessionId, input)
  unwrap(
    await getSDKClient(scope).session.summarize({
      sessionID: sessionId,
      ...apiScopeQuery(scope),
      ...params,
    }),
  )
  return true
}

/**
 * 获取子 session
 */
export async function getSessionChildren(sessionId: string, input?: ApiScopeInput): Promise<ApiSession[]> {
  const scope = resolveSessionApiScope(sessionId, input)
  const sessions = unwrap<ApiSession[]>(
    await getSDKClient(scope).session.children({ sessionID: sessionId, ...apiScopeQuery(scope) }),
  )
  rememberSessionApiScopes(sessions, scope)
  return sessions
}

/**
 * Session Todo
 */
export type ApiTodo = TodoItem

/**
 * 获取 session 的 todo 列表
 * SDK 的 Todo 没有 id 字段，用 index+content+status 合成
 */
export async function getSessionTodos(sessionId: string, input?: ApiScopeInput): Promise<ApiTodo[]> {
  const scope = resolveSessionApiScope(sessionId, input)
  const todos = unwrap(await getSDKClient(scope).session.todo({ sessionID: sessionId, ...apiScopeQuery(scope) }))
  return normalizeTodoItems(todos)
}

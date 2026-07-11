// ============================================
// PTY API - 终端管理
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { getApiBaseUrl, buildQueryString } from './http'
import { apiScopeQuery, resolveApiScope, type ApiScopeInput } from './scope'
import type { Pty, PtyCreateParams, PtyUpdateParams } from '../types/api/pty'

const PTY_CONNECT_TOKEN_HEADER = 'x-chimera-ticket'
const PTY_CONNECT_TOKEN_HEADER_VALUE = '1'

type LegacyPty = Pty & { running?: boolean; status?: Pty['status'] }
export interface ShellInfo {
  path: string
  name: string
  acceptable: boolean
}

interface PtyConnectUrlOptions {
  cursor?: number
  ticket?: string
}

function normalizePty(pty: LegacyPty): Pty {
  if (pty.status) return pty as Pty
  return {
    ...pty,
    status: pty.running ? 'running' : 'exited',
  } as Pty
}

/**
 * 获取所有 PTY 会话列表
 */
export async function listPtySessions(input?: ApiScopeInput): Promise<Pty[]> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).pty.list(apiScopeQuery(scope))).map(pty => normalizePty(pty as LegacyPty))
}

/**
 * 获取当前机器可用 shell 列表，用于 opencode config.shell 的候选项。
 */
export async function listAvailableShells(input?: ApiScopeInput): Promise<ShellInfo[]> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).pty.shells(apiScopeQuery(scope)))
}

/**
 * 创建新的 PTY 会话
 */
export async function createPtySession(params: PtyCreateParams, input?: ApiScopeInput): Promise<Pty> {
  const scope = resolveApiScope(input)
  return normalizePty(unwrap(await getSDKClient(scope).pty.create({ ...apiScopeQuery(scope), ...params })) as LegacyPty)
}

/**
 * 获取单个 PTY 会话信息
 */
export async function getPtySession(ptyId: string, input?: ApiScopeInput): Promise<Pty> {
  const scope = resolveApiScope(input)
  return normalizePty(unwrap(await getSDKClient(scope).pty.get({ ptyID: ptyId, ...apiScopeQuery(scope) })) as LegacyPty)
}

/**
 * 更新 PTY 会话
 */
export async function updatePtySession(ptyId: string, params: PtyUpdateParams, input?: ApiScopeInput): Promise<Pty> {
  const scope = resolveApiScope(input)
  return normalizePty(
    unwrap(
      await getSDKClient(scope).pty.update({
        ptyID: ptyId,
        ...apiScopeQuery(scope),
        ...params,
      }),
    ) as LegacyPty,
  )
}

/**
 * 删除 PTY 会话
 */
export async function removePtySession(ptyId: string, input?: ApiScopeInput): Promise<boolean> {
  const scope = resolveApiScope(input)
  unwrap(await getSDKClient(scope).pty.remove({ ptyID: ptyId, ...apiScopeQuery(scope) }))
  return true
}

export function buildPtyConnectUrl(ptyId: string, input?: ApiScopeInput, options?: PtyConnectUrlOptions): string {
  const scope = resolveApiScope(input)
  const cursor =
    typeof options?.cursor === 'number' && Number.isSafeInteger(options.cursor) && options.cursor >= -1
      ? options.cursor
      : undefined
  const websocketBaseUrl = getApiBaseUrl(scope).replace(/\/+$/, '').replace(/^http/, 'ws')
  return `${websocketBaseUrl}/pty/${encodeURIComponent(ptyId)}/connect${buildQueryString({
    ...apiScopeQuery(scope),
    cursor,
    ticket: options?.ticket,
  })}`
}

/**
 * 浏览器原生 WebSocket 无法设置 Authorization header。
 * 先通过已认证 HTTP 请求获取短期单次 ticket，再把 ticket 放进连接 URL。
 */
export async function getPtyConnectUrl(
  ptyId: string,
  input?: ApiScopeInput,
  options?: Pick<PtyConnectUrlOptions, 'cursor'>,
): Promise<string> {
  const scope = resolveApiScope(input)
  const token = unwrap(
    await getSDKClient(scope).pty.connectToken(
      { ptyID: ptyId, ...apiScopeQuery(scope) },
      { headers: { [PTY_CONNECT_TOKEN_HEADER]: PTY_CONNECT_TOKEN_HEADER_VALUE } },
    ),
  )
  if (typeof token.ticket !== 'string' || token.ticket.length === 0) {
    throw new Error('PTY connect token response did not include a ticket')
  }
  return buildPtyConnectUrl(ptyId, scope, { cursor: options?.cursor, ticket: token.ticket })
}

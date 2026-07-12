// ============================================
// LSP API - Language Server Protocol 状态
// ============================================

import type { FormatterStatus as SDKFormatterStatus, LspStatus as SDKLspStatus } from '@opencode-ai/sdk/v2/client'
import { apiScopeQuery, resolveApiScope, type ApiScopeInput } from './scope'
import { getSDKClient, unwrap } from './sdk'

export interface LSPStatus {
  running: boolean
  language?: string
  capabilities?: string[]
}

export async function getLspStatuses(input?: ApiScopeInput): Promise<SDKLspStatus[]> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).lsp.status(apiScopeQuery(scope)))
}

/**
 * 获取 LSP 服务状态
 */
export async function getLspStatus(input?: ApiScopeInput): Promise<LSPStatus> {
  const first = (await getLspStatuses(input))[0]
  if (!first) return { running: false }
  return {
    running: first.status === 'connected',
    language: first.name,
  }
}

export interface FormatterStatus {
  available: boolean
  name?: string
}

export async function getFormatterStatuses(input?: ApiScopeInput): Promise<SDKFormatterStatus[]> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).formatter.status(apiScopeQuery(scope)))
}

/**
 * 获取格式化器状态
 */
export async function getFormatterStatus(input?: ApiScopeInput): Promise<FormatterStatus> {
  const first = (await getFormatterStatuses(input))[0]
  if (!first) return { available: false }
  return {
    available: first.enabled === true,
    name: first.name,
  }
}

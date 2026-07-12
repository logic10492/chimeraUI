// ============================================
// MCP API - Model Context Protocol 服务器管理
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { apiScopeQuery, resolveApiScope, type ApiScopeInput } from './scope'
import type { MCPStatusResponse, McpServerConfig } from '../types/api/mcp'

/**
 * 获取所有 MCP 服务器状态
 */
export async function getMcpStatus(input?: ApiScopeInput): Promise<MCPStatusResponse> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).mcp.status(apiScopeQuery(scope)))
}

/**
 * 添加 MCP 服务器
 */
export async function addMcpServer(name: string, config: McpServerConfig, input?: ApiScopeInput): Promise<void> {
  const scope = resolveApiScope(input)
  unwrap(await getSDKClient(scope).mcp.add({ name, config, ...apiScopeQuery(scope) }))
}

/**
 * 连接到 MCP 服务器
 */
export async function connectMcpServer(name: string, input?: ApiScopeInput): Promise<void> {
  const scope = resolveApiScope(input)
  unwrap(await getSDKClient(scope).mcp.connect({ name, ...apiScopeQuery(scope) }))
}

/**
 * 断开 MCP 服务器连接
 */
export async function disconnectMcpServer(name: string, input?: ApiScopeInput): Promise<void> {
  const scope = resolveApiScope(input)
  unwrap(await getSDKClient(scope).mcp.disconnect({ name, ...apiScopeQuery(scope) }))
}

/**
 * 开始 MCP 认证流程
 */
export async function startMcpAuth(name: string, input?: ApiScopeInput): Promise<{ url: string }> {
  const scope = resolveApiScope(input)
  const result = unwrap(await getSDKClient(scope).mcp.auth.start({ name, ...apiScopeQuery(scope) }))
  // SDK 返回 { authorizationUrl: string }，转换为我们期望的 { url: string }
  return { url: result.authorizationUrl }
}

/**
 * 移除 MCP 认证
 */
export async function removeMcpAuth(name: string, input?: ApiScopeInput): Promise<void> {
  const scope = resolveApiScope(input)
  unwrap(await getSDKClient(scope).mcp.auth.remove({ name, ...apiScopeQuery(scope) }))
}

/**
 * 完成 MCP OAuth 认证（使用授权码）
 */
export async function completeMcpAuth(name: string, code: string, input?: ApiScopeInput): Promise<void> {
  const scope = resolveApiScope(input)
  unwrap(await getSDKClient(scope).mcp.auth.callback({ name, code, ...apiScopeQuery(scope) }))
}

/**
 * 启动完整的 OAuth 认证流程
 */
export async function authenticateMcp(name: string, input?: ApiScopeInput): Promise<void> {
  const scope = resolveApiScope(input)
  unwrap(await getSDKClient(scope).mcp.auth.authenticate({ name, ...apiScopeQuery(scope) }))
}

// ============================================
// Server capabilities - 服务端能力探测
//
// 能力由服务端 config 派生（例如 delegation.background_subagents
// kill-switch），按 ApiScope 缓存，避免每个组件重复拉取 config。
// 拉取失败时能力一律按关闭处理（fail-closed），UI 只少渲染标记，
// 不影响消息数据本身。
// ============================================

import { getConfig } from './config'
import { apiScopeKey, resolveApiScope, type ApiScopeInput } from './scope'

export interface ServerCapabilities {
  /** Background subagents (F4 engine) enabled on the server: delegation.background_subagents !== false. */
  backgroundSubagents: boolean
}

const cache = new Map<string, Promise<ServerCapabilities>>()

export function getServerCapabilities(input?: ApiScopeInput): Promise<ServerCapabilities> {
  const scope = resolveApiScope(input)
  const key = apiScopeKey(scope)
  const existing = cache.get(key)
  if (existing) return existing
  const promise = getConfig(scope)
    .then((config) => ({
      backgroundSubagents: config.delegation?.background_subagents !== false,
    }))
    .catch(() => ({ backgroundSubagents: false }))
  cache.set(key, promise)
  return promise
}

/** Drop cached capability resolutions (server switch/config update/tests). */
export function invalidateServerCapabilities(): void {
  cache.clear()
}

// ============================================
// Presence API - WebUI 在场心跳（性能战役 W1）
// ============================================

import { getApiBaseUrl, getAuthHeader } from './http'

/**
 * 上报一次在场心跳：服务器为 directories 中「已加载实例」的目录刷新
 * presence pin（服务端 TTL 默认 90s），保护实例不被空闲 TTL / 内存压力回收。
 *
 * 语义（与服务端 POST /global/presence 契约一致）：
 * - 未加载的目录被服务端忽略；presence 永远不会触发实例 boot。
 * - 返回 false 表示服务端拒绝/不可达；调用方应静默吞掉——丢一个周期的
 *   心跳只意味着服务端会按 TTL 自然回收，下一周期自动恢复。
 */
export async function reportPresence(directories: readonly string[]): Promise<boolean> {
  if (directories.length === 0) return true
  const response = await fetch(`${getApiBaseUrl()}/global/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ directories }),
  })
  return response.ok
}

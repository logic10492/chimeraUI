// ============================================
// Process API - 会话进程注册表
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { apiScopeQuery, resolveApiScope, type ApiScopeInput } from './scope'
import type { Process } from '../types/api/process'

/**
 * 列出当前实例中所有会话正在运行的子进程（跨会话视图）
 * 服务端按 started_at 升序返回，仅包含 running 行
 */
export async function listProcesses(input?: ApiScopeInput): Promise<Process[]> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).process.list(apiScopeQuery(scope)))
}

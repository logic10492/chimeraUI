// ============================================
// VCS API - 版本控制信息
// ============================================

import { getSDKClient, unwrap } from './sdk'
import type { FileDiff } from './types'
import type { VcsDiffMode, VcsInfo } from '../types/api/vcs'
import { apiScopeQuery, resolveApiScope, type ApiScopeInput } from './scope'
import { normalizeFileDiffs } from '../types/api/file'

/**
 * 获取 VCS 信息
 */
export async function getVcsInfo(input?: ApiScopeInput): Promise<VcsInfo | null> {
  try {
    const scope = resolveApiScope(input)
    return unwrap(await getSDKClient(scope).vcs.get(apiScopeQuery(scope)))
  } catch {
    // VCS 不可用时返回 null
    return null
  }
}

/**
 * 获取 Git 或分支维度的 diff
 */
export async function getVcsDiff(mode: VcsDiffMode, input?: ApiScopeInput): Promise<FileDiff[]> {
  const scope = resolveApiScope(input)
  return normalizeFileDiffs(unwrap(await getSDKClient(scope).vcs.diff({ mode, ...apiScopeQuery(scope) })))
}

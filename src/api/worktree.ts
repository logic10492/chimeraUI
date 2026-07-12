// ============================================
// Worktree API - Git Worktree 管理
// ============================================

import { getSDKClient, unwrap } from './sdk'
import type { Worktree, WorktreeCreateInput, WorktreeRemoveInput, WorktreeResetInput } from '../types/api/worktree'
import { apiScopeQuery, resolveApiScope, type ApiScopeInput } from './scope'

/**
 * 获取所有 worktree 列表
 */
export async function listWorktrees(input?: ApiScopeInput): Promise<string[]> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).worktree.list(apiScopeQuery(scope)))
}

/**
 * 创建新的 worktree
 */
export async function createWorktree(params: WorktreeCreateInput, input?: ApiScopeInput): Promise<Worktree> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).worktree.create({ ...apiScopeQuery(scope), worktreeCreateInput: params }))
}

/**
 * 删除 worktree
 */
export async function removeWorktree(params: WorktreeRemoveInput, input?: ApiScopeInput): Promise<boolean> {
  const scope = resolveApiScope(input)
  unwrap(await getSDKClient(scope).worktree.remove({ ...apiScopeQuery(scope), worktreeRemoveInput: params }))
  return true
}

/**
 * 重置 worktree
 */
export async function resetWorktree(params: WorktreeResetInput, input?: ApiScopeInput): Promise<boolean> {
  const scope = resolveApiScope(input)
  unwrap(await getSDKClient(scope).worktree.reset({ ...apiScopeQuery(scope), worktreeResetInput: params }))
  return true
}

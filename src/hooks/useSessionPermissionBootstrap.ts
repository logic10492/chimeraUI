// ============================================
// useSessionPermissionBootstrap - session 切换时恢复子 session 关系与待处理请求
// ============================================

import { useEffect, useRef } from 'react'
import { childSessionStore } from '../store/childSessionStore'
import { activeSessionStore } from '../store/activeSessionStore'
import { getPendingPermissions, getPendingQuestions } from '../api/permission'
import { isSameDirectory, normalizeToForwardSlash } from '../utils/directoryUtils'
import type { UsePermissionHandlerResult } from './usePermissionHandler'

export function useSessionPermissionBootstrap({
  routeSessionId,
  effectiveDirectory,
  sessionDirectory,
  resetPendingRequests,
  setPendingPermissionRequests,
  setPendingQuestionRequests,
}: {
  routeSessionId: string | null
  effectiveDirectory: string | undefined
  sessionDirectory: string
  resetPendingRequests: UsePermissionHandlerResult['resetPendingRequests']
  setPendingPermissionRequests: UsePermissionHandlerResult['setPendingPermissionRequests']
  setPendingQuestionRequests: UsePermissionHandlerResult['setPendingQuestionRequests']
}) {
  // Load child sessions and pending permissions on session change
  // 页面刷新时 childSessionStore 是空的，需要先从 API 恢复子 session 关系
  // 然后再加载权限请求（包括子 session 的权限）
  // 已执行的 routeSessionId+effectiveDirectory 组合（W3③）：相同组合只拉取一次，
  // 消除 StrictMode 双跑与依赖抖动引发的重复全量拉取
  const childPermissionsComboRef = useRef<string | null>(null)
  useEffect(() => {
    if (!routeSessionId) {
      childPermissionsComboRef.current = null
      resetPendingRequests()
      return
    }

    // effectiveDirectory 未就绪时跳过（W3③）：跨项目切换时 currentDirectory 滞后于
    // routeSessionId；当 session 元数据已知目标目录且与当前 effectiveDirectory 不一致时，
    // 等路由/会话状态追上再拉，避免用错误目录白跑一遍再重跑（权限/问题双份全量拉取）
    const metaDirectory = activeSessionStore.getSessionMeta(routeSessionId)?.directory
    if (!sessionDirectory && metaDirectory && !isSameDirectory(metaDirectory, effectiveDirectory)) return

    const combo = `${routeSessionId}\n${normalizeToForwardSlash(effectiveDirectory)}`
    if (childPermissionsComboRef.current === combo) return
    childPermissionsComboRef.current = combo

    let cancelled = false
    let completed = false

    async function loadChildSessionsAndPermissions() {
      // Step 1: 恢复子 session 关系（如果 store 中还没有）
      const existingChildren = childSessionStore.getChildSessionIds(routeSessionId!)
      if (existingChildren.length === 0) {
        try {
          // 共享缓存加载（W3①）：侧边栏与消息区用同一份 children 数据，
          // 冷切 1 次 /children，热切（缓存命中）0 次
          const children = await childSessionStore.loadChildren(routeSessionId!, effectiveDirectory)
          if (cancelled) return
          // 注册所有子 session 到 store
          for (const child of children) {
            childSessionStore.registerChildSession(child)
            // 历史恢复的子会话按服务端真相校正：store 已初始化且 statusMap 无非 idle 条目
            // 且无 pending 请求 → 实际已 idle，避免被活跃门补录成「工作中」
            const state = activeSessionStore.getSnapshot()
            if (state.initialized && !state.statusMap[child.id] && !activeSessionStore.hasPendingForSession(child.id)) {
              childSessionStore.markIdle(child.id)
            }
          }
        } catch {
          // 获取子 session 失败不影响主流程
        }
      }

      if (cancelled) return

      // Step 2: 获取完整的 session family（主 session + 所有子孙）
      const family = new Set(childSessionStore.getSessionAndDescendants(routeSessionId!))

      // Step 3: 获取所有待处理请求，然后用 family 过滤
      // GET /permission 和 GET /question 返回全量数据，不传 sessionId 避免 N 次重复请求
      const [allPerms, allQuestions] = await Promise.all([
        getPendingPermissions(undefined, effectiveDirectory).catch(() => []),
        getPendingQuestions(undefined, effectiveDirectory).catch(() => []),
      ])

      if (cancelled) return

      // 只保留属于当前 session family 的请求。
      // OMO background subagents may publish permission.asked over SSE before
      // /permission can list it for this routed instance, so do not drop
      // SSE-known requests just because the snapshot is missing them.
      const nextPerms = allPerms.filter(p => family.has(p.sessionID))
      setPendingPermissionRequests(prev => {
        const merged = new Map(nextPerms.map(p => [p.id, p]))
        for (const request of prev) {
          if (family.has(request.sessionID) && !merged.has(request.id)) merged.set(request.id, request)
        }
        return Array.from(merged.values())
      })
      setPendingQuestionRequests(allQuestions.filter(q => family.has(q.sessionID)))
      completed = true
    }

    loadChildSessionsAndPermissions()

    return () => {
      cancelled = true
      // 未完成即被取消：释放组合占位，允许后续 effect 重新拉取；
      // 已完成则保留占位，相同组合的重复 effect 直接跳过
      if (!completed && childPermissionsComboRef.current === combo) {
        childPermissionsComboRef.current = null
      }
    }
  }, [
    routeSessionId,
    effectiveDirectory,
    sessionDirectory,
    resetPendingRequests,
    setPendingPermissionRequests,
    setPendingQuestionRequests,
  ])
}
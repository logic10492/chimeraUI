// ============================================
// Session 列表更新合并（W2③ 差异比较）
// ============================================
//
// session.updated 事件高频触发列表更新。旧行为无条件把条目移动到列表
// 头部，导致内容没变时也整列表重排 + 重渲染。新行为：
// - 排序相关字段（title / time.created / time.updated / time.archived）
//   没变 → 仅原位更新条目，不重排；内容完全一致时保留原数组引用（零重渲染）。
// - 排序相关字段真变了 → 按服务端「最近更新在前」语义移到列表头部。

import type { ApiSession } from '../api/types'

/** 排序相关字段是否变化（服务端会话列表按最近更新排序） */
export function sessionOrderFieldsChanged(prev: ApiSession, next: ApiSession): boolean {
  return (
    prev.title !== next.title ||
    prev.time?.created !== next.time?.created ||
    prev.time?.updated !== next.time?.updated ||
    prev.time?.archived !== next.time?.archived
  )
}

/** 内容是否完全一致（用于跳过无意义的 state 更新，保持数组引用不变） */
export function isSameSessionContent(prev: ApiSession, next: ApiSession): boolean {
  return prev === next || JSON.stringify(prev) === JSON.stringify(next)
}

/**
 * 把一条 session.updated 事件合并进列表：
 * - 不属于当前视图（目录不匹配）→ 从列表移除（若存在）
 * - 不在列表中 → 插入头部
 * - 排序字段未变 → 原位替换条目；内容一致时返回原数组
 * - 排序字段变了 → 移到头部重排
 */
export function mergeSessionUpdate(
  prev: ApiSession[],
  session: ApiSession,
  matchesDirectory: (session: ApiSession) => boolean,
): ApiSession[] {
  const index = prev.findIndex(item => item.id === session.id)

  if (!matchesDirectory(session)) {
    return index === -1 ? prev : prev.filter(item => item.id !== session.id)
  }

  if (index === -1) {
    return [session, ...prev]
  }

  const existing = prev[index]

  if (!sessionOrderFieldsChanged(existing, session)) {
    if (isSameSessionContent(existing, session)) return prev
    return prev.map((item, i) => (i === index ? session : item))
  }

  return [session, ...prev.filter(item => item.id !== session.id)]
}

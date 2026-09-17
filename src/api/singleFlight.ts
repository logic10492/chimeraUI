// ============================================
// Single-flight - 幂等请求的 in-flight 共享
// ============================================
//
// N 个订阅者（多个 useSessions 实例、全局事件拉取、权限轮询）并发请求
// 同一 key（目录 + 查询参数）的数据时，只有第一个调用者真正发起请求，
// 其余调用者共享同一个 in-flight promise；请求 settle（成功或失败）后
// 条目立即移除，后续调用会重新发起。
//
// 目的：把「一个触发源 × N 个订阅者」的重复拉取收敛为一次网络请求，
// 避免 resync 风暴打满请求队列（WEBUI_PERFORMANCE_PLAN W2①）。

const inFlightRequests = new Map<string, Promise<unknown>>()

/**
 * 按 key 共享 in-flight promise。
 * - 已有同 key 请求在途：直接返回同一个 promise（失败也共享，窗口极短）
 * - 没有在途请求：执行 factory 并登记，settle 后自动移除
 */
export function singleFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key)
  if (existing) return existing as Promise<T>

  const promise = factory()
  inFlightRequests.set(key, promise)
  const settle = () => {
    if (inFlightRequests.get(key) === promise) inFlightRequests.delete(key)
  }
  promise.then(settle, settle)
  return promise
}

/**
 * 稳定序列化单飞 key：对象键排序，避免调用方构造顺序不同产生不同 key。
 * undefined 值字段与缺省字段序列化结果一致（语义相同的请求共享）。
 */
export function singleFlightKey(...parts: unknown[]): string {
  return JSON.stringify(parts, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(name => [name, (value as Record<string, unknown>)[name]]),
    )
  })
}

/** 清空所有 in-flight 条目（测试隔离用；正常流程条目 settle 后自动移除） */
export function clearSingleFlight(): void {
  inFlightRequests.clear()
}

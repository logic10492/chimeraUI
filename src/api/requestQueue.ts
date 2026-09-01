// ============================================
// Request Queue - 浏览器连接池保护
//
// Chrome 对同一 host 的 HTTP/1.1 并发连接上限为 6，其中 SSE 长连接占 1。
// 多目录 resync 等后台流量会瞬间打满剩余连接，导致 ERR_INSUFFICIENT_RESOURCES。
// 所有经 trackedFetch 的 SDK 请求在此排队：限制同时在途数量，并让交互请求插队。
// ============================================

export type RequestPriority = 'interactive' | 'background'

const MAX_CONCURRENT = 4

type QueuedTask = {
  onAbort: (() => void) | null
  run: () => void
}

let running = 0
const interactiveTasks: QueuedTask[] = []
const backgroundTasks: QueuedTask[] = []

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Request aborted', 'AbortError')
}

function pump() {
  while (running < MAX_CONCURRENT) {
    const task = interactiveTasks.shift() ?? backgroundTasks.shift()
    if (!task) return
    running++
    task.run()
  }
}

/**
 * 排队执行一个请求工厂函数。
 * - 同时在途请求不超过 MAX_CONCURRENT
 * - interactive 优先于 background
 * - signal 在排队期间 abort 时直接拒绝，不占用并发槽位
 */
export function scheduleRequest<T>(
  execute: () => Promise<T>,
  options?: { priority?: RequestPriority; signal?: AbortSignal | null },
): Promise<T> {
  const signal = options?.signal
  if (signal?.aborted) return Promise.reject(abortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const queue = options?.priority === 'interactive' ? interactiveTasks : backgroundTasks

    const task: QueuedTask = {
      onAbort: null,
      run: () => {
        if (signal && task.onAbort) signal.removeEventListener('abort', task.onAbort)
        execute()
          .then(resolve, reject)
          .finally(() => {
            running--
            pump()
          })
      },
    }

    if (signal) {
      task.onAbort = () => {
        const index = queue.indexOf(task)
        if (index >= 0) queue.splice(index, 1)
        reject(abortReason(signal))
      }
      signal.addEventListener('abort', task.onAbort, { once: true })
    }

    queue.push(task)
    pump()
  })
}

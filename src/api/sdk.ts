// ============================================
// SDK Client - 基于 @opencode-ai/sdk 的统一客户端
//
// 职责：
// 1. 根据当前活动服务器动态创建 SDK client
// 2. 整合 baseUrl / auth / tauri fetch
// 3. 为上层 API 模块提供统一的 client 获取方式
// ============================================

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { serverStore, makeBasicAuthHeader } from '../store/serverStore'
import { isTauri } from '../utils/tauri'
import { resolveApiScope, type ApiScopeInput } from './scope'
import { scheduleRequest, type RequestPriority } from './requestQueue'

// Tauri fetch 缓存
let _tauriFetch: typeof globalThis.fetch | null = null
let _tauriFetchLoading: Promise<typeof globalThis.fetch> | null = null
let _apiRequestGeneration = 0
const _apiRequestControllers = new Set<AbortController>()

async function getTauriFetch(): Promise<typeof globalThis.fetch> {
  if (_tauriFetch) return _tauriFetch
  if (_tauriFetchLoading) return _tauriFetchLoading
  _tauriFetchLoading = import('@tauri-apps/plugin-http').then(mod => {
    _tauriFetch = mod.fetch as unknown as typeof globalThis.fetch
    return _tauriFetch
  })
  return _tauriFetchLoading
}

function getFetchImpl(): typeof globalThis.fetch {
  return isTauri() && _tauriFetch ? _tauriFetch : globalThis.fetch
}

function createAbortError(message: string) {
  return new DOMException(message, 'AbortError')
}

async function executeTrackedRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  generation: number,
  priority: RequestPriority,
): Promise<Response> {
  const controller = new AbortController()
  const externalSignal = init?.signal
  const abortFromExternal = () => controller.abort(externalSignal?.reason)

  if (externalSignal?.aborted) {
    abortFromExternal()
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  }

  _apiRequestControllers.add(controller)

  try {
    if (generation !== _apiRequestGeneration) {
      throw createAbortError('Stale API request')
    }

    const execute = () =>
      getFetchImpl()(input, {
        ...init,
        signal: controller.signal,
      })

    // Tauri fetch 走 Rust 网络栈，不占浏览器连接池，无需排队
    if (getFetchImpl() !== globalThis.fetch) {
      return await execute()
    }
    return await scheduleRequest(execute, { priority, signal: controller.signal })
  } finally {
    externalSignal?.removeEventListener('abort', abortFromExternal)
    _apiRequestControllers.delete(controller)
  }
}

// ============================================
// GET 幂等请求 in-flight 单飞（W3②）
// ============================================
//
// 并发重复的 GET（method+path+params 相同 → URL 相同）共享同一次网络往返：
// 双路径拉取（侧边栏/消息区）与 effect 双跑不再产生重复请求，也不额外
// 占用 requestQueue 的 4 个并发槽。每个调用者拿到独立的 Response clone
// （body 只能消费一次）；单个调用者的 abort 只拒绝它自己，不影响其他
// 共享者（共享请求不绑定首个调用者的 signal）。server 切换后 generation
// 递增：旧条目随控制器 abort 整体失败，新调用不会加入旧代次条目。
const _inFlightGetRequests = new Map<string, Promise<Response>>()

function requestMethodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method.toUpperCase()
  return 'GET'
}

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function raceAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? createAbortError('Request aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? createAbortError('Request aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function trackedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  generation: number,
  priority: RequestPriority = 'background',
): Promise<Response> {
  if (requestMethodOf(input, init) !== 'GET' || generation !== _apiRequestGeneration) {
    return executeTrackedRequest(input, init, generation, priority)
  }

  const key = `${generation}|${requestUrlOf(input)}`
  let shared = _inFlightGetRequests.get(key)
  if (!shared) {
    // 共享请求不绑定首个调用者的外部 signal：单飞期间任意一个调用者
    // abort 不能终止其他共享者；全局中止仍由 abortInFlightApiRequests 覆盖
    shared = executeTrackedRequest(input, init ? { ...init, signal: undefined } : init, generation, priority)
    _inFlightGetRequests.set(key, shared)
    const cleanup = () => {
      if (_inFlightGetRequests.get(key) === shared) _inFlightGetRequests.delete(key)
    }
    shared.then(cleanup, cleanup)
  }
  return (await raceAbortSignal(shared, init?.signal)).clone()
}

export function abortInFlightApiRequests(reason = 'Server endpoint changed'): void {
  _apiRequestGeneration++
  for (const controller of _apiRequestControllers) {
    controller.abort(createAbortError(reason))
  }
  _apiRequestControllers.clear()
}

// Client 缓存：按 server identity + endpoint + auth 缓存实例，避免跨 server 复用
const _cachedClients = new Map<string, OpencodeClient>()

function buildCacheKey(serverID: string, baseUrl: string): string {
  const auth = serverStore.getServerAuth(serverID)
  const authPart = auth?.password ? `${auth.username}:${auth.password}` : ''
  return `${serverID}|${baseUrl}|${authPart}`
}

function buildHeaders(serverID: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const auth = serverStore.getServerAuth(serverID)
  if (auth?.password) {
    headers['Authorization'] = makeBasicAuthHeader(auth)
  }
  return headers
}

/**
 * 同步获取 SDK client（浏览器环境 or tauri fetch 已加载）
 * 如果 tauri fetch 还没加载完，先用原生 fetch
 */
export function getSDKClient(input?: ApiScopeInput, options?: { priority?: RequestPriority }): OpencodeClient {
  const scope = resolveApiScope(input)
  const baseUrl = serverStore.getServerBaseUrl(scope.serverID)
  const priority = options?.priority ?? 'background'
  const key = `${buildCacheKey(scope.serverID, baseUrl)}|${priority}`
  const cached = _cachedClients.get(key)
  if (cached) return cached

  const generation = _apiRequestGeneration
  const client = createOpencodeClient({
    baseUrl,
    headers: buildHeaders(scope.serverID),
    fetch: (request, init) => trackedFetch(request, init, generation, priority),
  })
  _cachedClients.set(key, client)
  return client
}

/**
 * 用户手势触发的请求（发消息、回复权限/问题、打开 session 等）
 * 使用 interactive 优先级，插队于后台 resync 流量
 */
export function getInteractiveSDKClient(input?: ApiScopeInput): OpencodeClient {
  return getSDKClient(input, { priority: 'interactive' })
}

/**
 * 异步获取 SDK client（确保 tauri fetch 已加载）
 * 在应用初始化时应该先调一次这个
 */
export async function getSDKClientAsync(input?: ApiScopeInput): Promise<OpencodeClient> {
  if (isTauri()) {
    await getTauriFetch()
  }
  // 使 cache 失效以便用新的 tauri fetch 重建
  _cachedClients.clear()
  return getSDKClient(input)
}

/**
 * 强制重建 client（服务器配置变化时调用）
 */
export function invalidateSDKClient(): void {
  _cachedClients.clear()
}

/**
 * 从 SDK 返回值中提取 data，如果有 error 则抛出
 *
 * SDK 默认返回 { data, error, request, response }
 * 我们的上层 API 函数期望直接返回数据，所以需要 unwrap
 */
export function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error != null) {
    const err = result.error
    if (err instanceof Error) throw err
    if (typeof err === 'string') throw new Error(err)
    throw new Error(JSON.stringify(err))
  }
  return result.data as T
}

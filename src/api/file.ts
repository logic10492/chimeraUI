// ============================================
// File Search API Functions
// 基于 @opencode-ai/sdk: /file, /find/file, /find/symbol 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import type { FileNode, FileContent, FileStatusItem, SymbolInfo } from './types'
import { apiScopeKey, apiScopeQuery, resolveApiScope, type ApiScope, type ApiScopeInput } from './scope'

const ROOT_DIRECTORY_CACHE_TTL_MS = 10_000

const rootDirectoryCache = new Map<string, { data: FileNode[]; expiresAt: number }>()
const rootDirectoryInflight = new Map<string, Promise<FileNode[]>>()
const rootDirectoryGeneration = new Map<string, number>()

function isRootDirectoryPath(path: string): boolean {
  return path === '' || path === '.' || path === './'
}

function getRootDirectoryCacheKey(scope: ApiScope): string {
  return apiScopeKey(scope)
}

export function invalidateRootDirectoryCache(input?: ApiScopeInput) {
  const key = getRootDirectoryCacheKey(resolveApiScope(input))
  rootDirectoryGeneration.set(key, (rootDirectoryGeneration.get(key) ?? 0) + 1)
  rootDirectoryCache.delete(key)
  rootDirectoryInflight.delete(key)
}

export function invalidateAllRootDirectoryCaches() {
  const keys = new Set([
    ...rootDirectoryCache.keys(),
    ...rootDirectoryInflight.keys(),
    ...rootDirectoryGeneration.keys(),
  ])
  keys.forEach(key => {
    rootDirectoryGeneration.set(key, (rootDirectoryGeneration.get(key) ?? 0) + 1)
  })
  rootDirectoryCache.clear()
  rootDirectoryInflight.clear()
}

async function fetchDirectory(path: string, input?: ApiScopeInput): Promise<FileNode[]> {
  const scope = resolveApiScope(input)
  const isAbsolute = /^[a-zA-Z]:/.test(path) || path.startsWith('/')

  if (isAbsolute && !scope.directory && !scope.workspace) {
    const absoluteScope = resolveApiScope({ serverID: scope.serverID, directory: path })
    return unwrap(await getSDKClient(absoluteScope).file.list({ ...apiScopeQuery(absoluteScope), path: '' }))
  }

  return unwrap(await getSDKClient(scope).file.list({ path, ...apiScopeQuery(scope) }))
}

/**
 * 搜索文件或目录
 */
export async function searchFiles(
  query: string,
  options: {
    directory?: string
    scope?: ApiScopeInput
    type?: 'file' | 'directory'
    limit?: number
  } = {},
): Promise<string[]> {
  const scope = resolveApiScope(options.scope ?? options.directory)
  return unwrap(
    await getSDKClient(scope).find.files({
      query,
      ...apiScopeQuery(scope),
      type: options.type,
      limit: options.limit,
    }),
  ) as string[]
}

/**
 * 列出目录内容
 */
export async function listDirectory(path: string, input?: ApiScopeInput): Promise<FileNode[]> {
  if (!isRootDirectoryPath(path)) {
    return fetchDirectory(path, input)
  }

  const scope = resolveApiScope(input)
  const key = getRootDirectoryCacheKey(scope)
  const now = Date.now()
  const cached = rootDirectoryCache.get(key)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  const inflight = rootDirectoryInflight.get(key)
  if (inflight) {
    return inflight
  }

  const generation = rootDirectoryGeneration.get(key) ?? 0
  const request = fetchDirectory(path === '' ? '.' : path, scope)
    .then(data => {
      if ((rootDirectoryGeneration.get(key) ?? 0) === generation) {
        rootDirectoryCache.set(key, { data, expiresAt: Date.now() + ROOT_DIRECTORY_CACHE_TTL_MS })
      }
      return data
    })
    .finally(() => {
      if (rootDirectoryInflight.get(key) === request) {
        rootDirectoryInflight.delete(key)
      }
    })

  rootDirectoryInflight.set(key, request)
  return request
}

export async function prefetchRootDirectory(input?: ApiScopeInput): Promise<void> {
  await listDirectory('.', input)
}

/**
 * 读取文件内容
 */
export async function getFileContent(path: string, input?: ApiScopeInput): Promise<FileContent> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).file.read({ path, ...apiScopeQuery(scope) }))
}

/**
 * 获取文件 git 状态
 */
export async function getFileStatus(input?: ApiScopeInput): Promise<FileStatusItem[]> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).file.status(apiScopeQuery(scope)))
}

/**
 * 搜索代码符号
 */
export async function searchSymbols(query: string, input?: ApiScopeInput): Promise<SymbolInfo[]> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).find.symbols({ query, ...apiScopeQuery(scope) }))
}

/**
 * 搜索目录（便捷方法）
 */
export async function searchDirectories(query: string, input?: ApiScopeInput, limit: number = 50): Promise<string[]> {
  return searchFiles(query, {
    scope: input,
    type: 'directory',
    limit,
  })
}

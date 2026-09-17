import { isSameDirectory, normalizeForComparison } from './directoryUtils'

interface CollectActiveDirectoriesOptions {
  routeDirectory?: string
  currentDirectory?: string
  paneDirectories?: string[]
  projectDirectories?: string[]
}

export function collectActiveDirectories({
  routeDirectory,
  currentDirectory,
  paneDirectories = [],
  projectDirectories = [],
}: CollectActiveDirectoriesOptions): string[] {
  const directories: string[] = []

  const pushDirectory = (directory?: string) => {
    if (!directory) return
    if (directories.some(existing => isSameDirectory(existing, directory))) return
    directories.push(directory)
  }

  pushDirectory(routeDirectory)
  pushDirectory(currentDirectory)
  paneDirectories.forEach(pushDirectory)
  projectDirectories.forEach(pushDirectory)

  return directories
}

/**
 * 目录集合的稳定内容 key：规范化 + 排序 + join。
 * 数组引用变化但内容（含顺序）不变时 key 不变，
 * 下游 effect 据此跳过无意义的刷新（W2②，消除 3×N 请求突发）。
 */
export function activeDirectoriesKey(directories: readonly (string | undefined)[] | undefined): string {
  if (!directories || directories.length === 0) return ''
  return directories
    .map(directory => normalizeForComparison(directory))
    .filter(Boolean)
    .sort()
    .join('\n')
}

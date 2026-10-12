import { getFileName, normalizePath } from '../mention/utils'

export const TEXTAREA_MIN_HEIGHT = 24
export const TEXTAREA_VERTICAL_CHROME = 24
export const INPUT_TOOLBAR_FALLBACK_HEIGHT = 36
export const INPUT_FOOTER_FALLBACK_HEIGHT = 32
export const COMPOSER_MIN_HEIGHT = 144
export const COMPOSER_DESKTOP_MAX_HEIGHT = 420
export const COMPOSER_COMPACT_MAX_HEIGHT = 320

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function getComposerMaxHeight(paneHeight: number, isCompact: boolean): number {
  const ratio = isCompact ? 0.44 : 0.4
  const hardMax = isCompact ? COMPOSER_COMPACT_MAX_HEIGHT : COMPOSER_DESKTOP_MAX_HEIGHT
  const availableMax = Math.max(COMPOSER_MIN_HEIGHT, paneHeight - 96)
  return clamp(Math.floor(paneHeight * ratio), COMPOSER_MIN_HEIGHT, Math.min(hardMax, availableMax))
}

export function getMentionPathForDroppedPath(absolutePath: string, rootPath: string): string {
  const normalizedPath = normalizePath(absolutePath)
  const normalizedRoot = normalizePath(rootPath).replace(/\/+$/, '')
  if (!normalizedRoot) return normalizedPath

  const caseInsensitive = /^[a-zA-Z]:/.test(normalizedPath) || /^[a-zA-Z]:/.test(normalizedRoot)
  const comparablePath = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath
  const comparableRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot

  if (comparablePath === comparableRoot) {
    return getFileName(normalizedPath)
  }

  if (comparablePath.startsWith(`${comparableRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }

  return normalizedPath
}
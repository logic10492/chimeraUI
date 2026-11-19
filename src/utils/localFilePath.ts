// ============================================
// Local file path detection (markdown text)
// ============================================
//
// 纯同步文本形状判断，不做任何文件存在性检查（渲染期不能有 fs/异步）。
// 这是 HTML 渲染路径（markdownHtmlRenderer）与 React 渲染路径（MarkdownRenderer）
// 共用的唯一检测实现。

export interface ParsedLocalFilePath {
  /** 去掉 :line 后缀后的路径（保留原始分隔符） */
  path: string
  /** 原始值（含 :line 后缀），用于 href/点击回传 */
  raw: string
  /** :123 / :123:45 后缀解析出的起始行 */
  targetLine?: number
}

export interface LocalFilePathMatch extends ParsedLocalFilePath {
  /** 命中的原文（含 :line 后缀，已剥离尾随标点） */
  start: number
  end: number
}

const TRAILING_PUNCTUATION = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  "'",
  '"',
  ')',
  ']',
  '}',
  '。',
  '，',
  '；',
  '：',
  '！',
  '？',
  '）',
  '】',
  '》',
  '」',
  '』',
  '、',
])

// 扫描 token 时遇到这些字符即停止（空白与常见 HTML/引号边界）。
const TOKEN_STOP_CHARS = new Set([' ', '\t', '\n', '\r', '\f', '\v', '`', '<', '>', '"', '|'])

const LINE_SUFFIX_PATTERN = /:(\d+)(?::\d+)?$/
const SCHEME_URL_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
const KNOWN_SCHEME_PATTERN = /^(?:https?|ftps?|mailto|tel|data|javascript|vbscript|ssh|git|file):/i
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/
const DOMAIN_LIKE_PATTERN = /^(?:[A-Za-z0-9-]+\.)+(?:com|org|net|io|dev|ai|cn|co|me|app|xyz|info|edu|gov)$/i
const EXTENSION_PATTERN = /\.[A-Za-z][A-Za-z0-9]{0,9}$/

function getFirstSegment(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^(?:\.\.?\/)+/, '')
  return normalized.split('/')[0] ?? ''
}

function hasValidExtension(value: string): boolean {
  const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  const basename = separatorIndex === -1 ? value : value.slice(separatorIndex + 1)
  return EXTENSION_PATTERN.test(basename)
}

function isDomainLike(segment: string): boolean {
  return DOMAIN_LIKE_PATTERN.test(segment.replace(/:\d+$/, ''))
}

function normalizePathShape(value: string, allowBareFilename: boolean): string | null {
  if (!value || value.startsWith('#')) return null
  if (SCHEME_URL_PATTERN.test(value) || KNOWN_SCHEME_PATTERN.test(value)) return null

  const hasSeparator = /[\\/]/.test(value)
  const absolute = value.startsWith('/') || WINDOWS_ABSOLUTE_PATTERN.test(value)
  if (!hasSeparator && !(allowBareFilename && !absolute)) return null
  if (!absolute) {
    const firstSegment = getFirstSegment(value)
    if (!firstSegment) return null
    if (firstSegment.includes('@') || isDomainLike(firstSegment)) return null
  }
  if (!hasValidExtension(value)) return null

  return value
}

function splitLineSuffix(value: string): Pick<ParsedLocalFilePath, 'path' | 'targetLine'> {
  const lineMatch = LINE_SUFFIX_PATTERN.exec(value)
  if (!lineMatch) return { path: value }
  return { path: value.slice(0, lineMatch.index), targetLine: Number(lineMatch[1]) }
}

/**
 * 解析一个完整路径值（markdown 链接 href、codespan 内容、点击回传值）。
 * 前后空白会被裁剪；含内部空白直接判为非路径。
 */
export function parseLocalFilePath(
  value: string,
  options?: { allowBareFilename?: boolean },
): ParsedLocalFilePath | null {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  const split = splitLineSuffix(trimmed)
  const path = normalizePathShape(split.path, options?.allowBareFilename ?? false)
  if (!path) return null
  const raw = split.targetLine == null ? path : `${path}:${split.targetLine}`
  return split.targetLine == null ? { path, raw } : { path, raw, targetLine: split.targetLine }
}

/**
 * 从 index 处尝试匹配一个裸文本路径 token。
 * 调用方负责只在非特殊语法位置调用；返回值的 start/end 用于切片。
 */
export function matchLocalFilePathAt(
  text: string,
  index: number,
  options?: { allowBareFilename?: boolean },
): LocalFilePathMatch | null {
  const first = text[index]
  if (!first || !/[A-Za-z0-9._~/\\]/.test(first)) return null
  if (index > 0 && /[A-Za-z0-9_.@-]/.test(text[index - 1])) return null
  // N3: 同一 token 的首个分隔符前出现 @ 时整体跳过（email / npm scope）
  let wordStart = index
  const backLimit = Math.max(0, index - 128)
  while (wordStart > backLimit && !TOKEN_STOP_CHARS.has(text[wordStart - 1])) wordStart -= 1
  if (text.slice(wordStart, index).includes('@')) return null

  let end = index
  while (end < text.length && !TOKEN_STOP_CHARS.has(text[end])) end += 1
  if (end === index) return null

  // URL 形状的 token 整体拒绝：防止 cursor 在 token 中部位置绕过首段 scheme/域名检查，
  // 把尾段误链接化（如 github.com/foo/bar.ts 中的 foo/bar.ts）。
  const whole = text.slice(wordStart, end)
  if (SCHEME_URL_PATTERN.test(whole) || KNOWN_SCHEME_PATTERN.test(whole)) return null
  if (!whole.startsWith('/') && !WINDOWS_ABSOLUTE_PATTERN.test(whole) && isDomainLike(getFirstSegment(whole))) return null

  let token = text.slice(index, end)
  let targetLine: number | undefined
  while (token.length > 0) {
    const lineMatch = LINE_SUFFIX_PATTERN.exec(token)
    if (lineMatch) {
      targetLine = Number(lineMatch[1])
      token = token.slice(0, lineMatch.index)
      continue
    }
    const last = token[token.length - 1]
    if (!TRAILING_PUNCTUATION.has(last)) break
    token = token.slice(0, -1)
  }

  const path = normalizePathShape(token, options?.allowBareFilename ?? false)
  if (!path) return null
  const raw = targetLine == null ? path : `${path}:${targetLine}`
  return {
    path,
    raw,
    start: index,
    end: index + raw.length,
    ...(targetLine == null ? {} : { targetLine }),
  }
}
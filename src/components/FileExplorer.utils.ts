import type { TextSearchMatch } from '../api/types'
import type { TargetLineRange } from './codeMirrorReadonlyExtensions'

export const MIN_TREE_HEIGHT = 100
export const MIN_PREVIEW_HEIGHT = 150

export const MARKDOWN_MIME_TYPES = new Set(['text/markdown', 'text/x-markdown', 'text/md', 'application/markdown'])
const textEncoder = new TextEncoder()

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 20
export const ZOOM_FACTOR = 1.15 // 每次滚轮的缩放倍率

export function isMarkdownPreview(language: string, mimeType?: string): boolean {
  if (language === 'markdown' || language === 'mdx') return true
  if (!mimeType) return false
  return MARKDOWN_MIME_TYPES.has(mimeType.split(';', 1)[0].toLowerCase())
}

export function byteOffsetToCodeUnitIndex(text: string, byteOffset: number): number {
  let bytes = 0
  let index = 0

  while (index < text.length && bytes < byteOffset) {
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined) break

    const char = String.fromCodePoint(codePoint)
    const charBytes = textEncoder.encode(char).length
    if (bytes + charBytes > byteOffset) break

    bytes += charBytes
    index += char.length
  }

  return Math.min(index, text.length)
}

export function getSearchMatchRanges(match: TextSearchMatch): TargetLineRange[] {
  return match.submatches
    .map(submatch => ({
      from: byteOffsetToCodeUnitIndex(match.lines.text, submatch.start),
      to: byteOffsetToCodeUnitIndex(match.lines.text, submatch.end),
    }))
    .filter(range => range.to > range.from)
}
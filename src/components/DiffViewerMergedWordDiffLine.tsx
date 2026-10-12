import type { HighlightToken, WordDiffSegment } from './DiffViewer.types'

export interface MergedWordDiffLineProps {
  segments: WordDiffSegment[]
  lineTokens: HighlightToken[]
}

/**
 * 合并渲染：syntax token 提供文字颜色，word diff segment 提供背景色。
 *
 * 两者的切分边界不同，需要对齐遍历——
 * 遍历 word diff segment，在每个 segment 内部按 syntax token 切分渲染。
 */
export function MergedWordDiffLine({ segments, lineTokens }: MergedWordDiffLineProps) {
  const result: React.ReactNode[] = []
  let tokenIdx = 0
  let tokenOffset = 0 // 当前 token 内已消费的字符数

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si]
    let remaining = seg.text.length
    const bgClass = seg.diffType === 'delete' ? 'bg-danger-100/30' : seg.diffType === 'add' ? 'bg-success-100/30' : ''
    const children: React.ReactNode[] = []

    while (remaining > 0 && tokenIdx < lineTokens.length) {
      const token = lineTokens[tokenIdx]
      const available = token.content.length - tokenOffset
      const take = Math.min(remaining, available)
      const slice = token.content.substring(tokenOffset, tokenOffset + take)

      children.push(
        <span key={`${si}-${tokenIdx}-${tokenOffset}`} style={token.color ? { color: token.color } : undefined}>
          {slice}
        </span>,
      )

      remaining -= take
      tokenOffset += take
      if (tokenOffset >= token.content.length) {
        tokenIdx++
        tokenOffset = 0
      }
    }

    // 如果 token 用完了但 segment 还有剩余（不应该发生，但防御性处理）
    if (remaining > 0) {
      const extraStart = seg.text.length - remaining
      children.push(<span key={`${si}-extra`}>{seg.text.substring(extraStart)}</span>)
    }

    if (bgClass) {
      result.push(
        <span key={si} className={bgClass}>
          {children}
        </span>,
      )
    } else {
      result.push(...children)
    }
  }

  return <>{result}</>
}
import { memo } from 'react'
import { MergedWordDiffLine } from './DiffViewerMergedWordDiffLine'
import type { DiffLine, HighlightToken } from './DiffViewer.types'
import type { HighlightTokens } from '../hooks/useSyntaxHighlight'

export interface LineContentProps {
  line: DiffLine
  tokens: HighlightTokens | null
}

export const LineContent = memo(function LineContent({ line, tokens }: LineContentProps) {
  const lineTokens = tokens && line.lineNo ? tokens[line.lineNo - 1] : null

  // 有 word diff 标记时：在语法着色基础上叠加增删背景
  if (line.wordDiffSegments) {
    // 有语法 token → 合并渲染（token 提供颜色，word diff segment 提供背景）
    if (lineTokens) {
      return <MergedWordDiffLine segments={line.wordDiffSegments} lineTokens={lineTokens} />
    }
    // 无语法 token → 纯 word diff（文字用默认色 + 增删背景）
    return (
      <>
        {line.wordDiffSegments.map((seg, i) =>
          seg.diffType ? (
            <span key={i} className={seg.diffType === 'delete' ? 'bg-danger-100/30' : 'bg-success-100/30'}>
              {seg.text}
            </span>
          ) : (
            <span key={i} className="text-text-100">
              {seg.text}
            </span>
          ),
        )}
      </>
    )
  }

  // 无 word diff，有语法高亮
  if (lineTokens) {
    return (
      <>
        {lineTokens.map((token: HighlightToken, i: number) => (
          <span key={i} style={{ color: token.color }}>
            {token.content}
          </span>
        ))}
      </>
    )
  }

  // 纯文本
  return <span className="text-text-100">{line.content}</span>
})
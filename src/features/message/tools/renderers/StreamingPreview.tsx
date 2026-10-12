import { useTranslation } from 'react-i18next'
import { ContentBlock } from '../../../../components'
import { detectLanguage } from '../../../../utils/languageUtils'
import type { StreamingHunk } from '../../../../types/message'

// ============================================
// Streaming Preview
// 流式工具参数预览的纯展示组件（从 DefaultRenderer 活跃分支抽取）：
// 已完成 op 的逐 hunk diff 卡片 + 正在增长的参数文本卡片。
// 无 store/session 耦合，便于 playground 视觉走查与独立测试。
// ============================================

export interface StreamingPreviewProps {
  /** 已完成的流式 hunks（part.state.hunks，live-only） */
  hunks?: StreamingHunk[]
  /** 正在增长的参数文本（ExtractedToolData.streamingPreview.text） */
  previewText?: string
  /** 标签/语言的兜底文件路径（hunk 无 filePath 时与预览卡片使用） */
  filePath?: string
  /** 预览文本的显式语言（覆盖由 filePath 推断的语言） */
  language?: string
  compact?: boolean
  /** ContentBlock 折叠状态缓存 key 的命名空间 */
  stateBaseKey: string
  /** ContentBlock 全屏层 ID 的命名空间 */
  fullscreenBaseId: string
  onFullscreenChange?: (isFullscreen: boolean) => void
}

export function StreamingPreview({
  hunks,
  previewText,
  filePath,
  language,
  compact,
  stateBaseKey,
  fullscreenBaseId,
  onFullscreenChange,
}: StreamingPreviewProps) {
  const { t } = useTranslation('message')

  if (!hunks?.length && !previewText) return null

  return (
    <div className="flex flex-col gap-2">
      {hunks?.map((hunk, idx) => (
        <ContentBlock
          key={`${hunk.index}-${idx}`}
          stateKey={`${stateBaseKey}:hunk:${hunk.index ?? idx}`}
          label={formatHunkLabel(hunk, idx, t)}
          filePath={hunk.filePath ?? filePath}
          diff={{ before: hunk.before, after: hunk.after }}
          language={detectLanguage(hunk.filePath ?? filePath)}
          compact={compact}
          onFullscreenChange={onFullscreenChange}
          fullscreenId={`${fullscreenBaseId}:hunk:${hunk.index ?? idx}`}
        />
      ))}
      {previewText && (
        <ContentBlock
          stateKey={`${stateBaseKey}:streaming-preview`}
          label={t('defaultRenderer.preview')}
          labelIcon={<StreamingCaret />}
          content={previewText}
          language={language}
          filePath={filePath}
          streaming
          compact={compact}
          onFullscreenChange={onFullscreenChange}
          fullscreenId={`${fullscreenBaseId}:streaming-preview`}
        />
      )}
    </div>
  )
}

function formatHunkLabel(
  hunk: StreamingHunk,
  idx: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const label = t('defaultRenderer.hunk', { index: idx + 1 })
  return hunk.pos ? `${label} · ${hunk.pos}` : label
}

/** CSS-only 流式指示：Preview 标签前闪烁的 ▍（复用 terminal-blink keyframes） */
function StreamingCaret() {
  return (
    <span className="leading-none text-accent-main-100" style={{ animation: 'terminal-blink 1s step-end infinite' }}>
      ▍
    </span>
  )
}

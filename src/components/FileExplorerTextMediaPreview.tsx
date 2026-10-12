// ============================================
// Text Media Preview - 文本型可渲染媒体（如 SVG）
// 支持 Preview / Code 两种视图切换
// ============================================

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CodePreview } from './CodePreview'
import { ImagePreview } from './FileExplorerImagePreview'
import type { TextMediaPreviewProps } from './FileExplorer.types'

export function TextMediaPreview({
  dataUrl,
  text,
  language,
  fileName,
  isResizing = false,
  targetLine,
  targetKey,
  targetRanges,
}: TextMediaPreviewProps) {
  const { t } = useTranslation(['components', 'common'])
  const [mode, setMode] = useState<'preview' | 'code'>(targetLine ? 'code' : 'preview')

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 py-1 border-b border-border-100/30 bg-bg-100/50 text-[length:var(--fs-xxs)]">
        <button
          onClick={() => setMode('preview')}
          className={`px-2 py-0.5 rounded transition-colors ${mode === 'preview' ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          {t('common:preview')}
        </button>
        <button
          onClick={() => setMode('code')}
          className={`px-2 py-0.5 rounded transition-colors ${mode === 'code' ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200 hover:text-text-100'}`}
        >
          {t('common:code')}
        </button>
      </div>
      {/* Content */}
      {mode === 'preview' ? (
        <ImagePreview dataUrl={dataUrl} fileName={fileName} />
      ) : (
        <div className="flex-1 min-h-0">
          <CodePreview
            code={text}
            language={language}
            isResizing={isResizing}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        </div>
      )}
    </div>
  )
}
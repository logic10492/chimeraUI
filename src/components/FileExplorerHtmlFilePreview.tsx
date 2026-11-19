import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CodePreview } from './CodePreview'
import { createSandboxedHtmlDocument } from './htmlSandbox'
import { useTheme } from '../hooks/useTheme'
import type { HtmlFilePreviewProps } from './FileExplorer.types'

export function HtmlFilePreview({
  text,
  isResizing = false,
  targetLine,
  targetKey,
  targetRanges,
}: HtmlFilePreviewProps) {
  const { t } = useTranslation(['components', 'common'])
  const [mode, setMode] = useState<'preview' | 'code'>(targetLine ? 'code' : 'preview')
  const resizeId = useId()
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light'
  const srcDoc = useMemo(
    () => createSandboxedHtmlDocument(text, resizeId, theme, { overflow: 'auto' }),
    [resizeId, text, theme],
  )

  return (
    <div className="flex flex-col h-full">
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

      {mode === 'preview' ? (
        <div className="flex-1 min-h-0">
          <iframe
            title="HTML preview"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
            style={{ colorScheme: theme }}
            className="block h-full w-full border-0 bg-transparent"
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <CodePreview
            code={text}
            language="html"
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
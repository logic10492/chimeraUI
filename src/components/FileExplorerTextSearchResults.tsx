import { memo, useCallback, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircleIcon } from './Icons'
import { getMaterialIconUrl } from '../utils/materialIcons'
import { startInternalDrag } from '../lib/internalDragCore'
import { toAbsolutePath } from '../features/mention/utils'
import type { TextSearchResultsProps } from './FileExplorer.types'

export const TextSearchResults = memo(function TextSearchResults({
  results,
  fileResults,
  isLoading,
  error,
  onSelect,
  onSelectFile,
  directory,
}: TextSearchResultsProps) {
  const { t } = useTranslation(['components', 'common'])

  const hasFiles = fileResults.length > 0
  const hasText = results.length > 0

  // 拖拽到输入框实现 @mention，与文件树项行为一致
  const handlePointerDragStart = useCallback(
    (e: PointerEvent<HTMLButtonElement>, path: string) => {
      if (!directory) return
      const name = path.split(/[/\\]/).pop() || path
      startInternalDrag(e, {
        kind: 'file-mention',
        file: {
          type: 'file',
          path,
          absolute: toAbsolutePath(path, directory),
          name,
        },
      })
    },
    [directory],
  )

  if (isLoading && !hasFiles && !hasText) {
    return <div className="flex items-center justify-center h-20 text-text-400 text-[length:var(--fs-sm)]">{t('common:loading')}</div>
  }

  if (error && !hasFiles && !hasText) {
    return (
      <div className="flex flex-col items-center justify-center h-20 text-danger-100 text-[length:var(--fs-sm)] gap-1 px-4">
        <AlertCircleIcon size={16} />
        <span className="text-center">{error}</span>
      </div>
    )
  }

  if (!hasFiles && !hasText) {
    return (
      <div className="flex items-center justify-center h-20 text-text-400 text-[length:var(--fs-sm)]">
        {t('fileExplorer.noTextMatches')}
      </div>
    )
  }

  return (
    <div className="py-1">
      {hasFiles && (
        <>
          <div className="px-2 py-1 text-[length:var(--fs-xxs)] font-medium text-text-500 uppercase tracking-wide">
            {t('fileExplorer.fileMatches')}
          </div>
          {fileResults.map(path => {
            const name = path.split(/[/\\]/).pop() || path
            return (
              <button
                key={`file:${path}`}
                type="button"
                onPointerDown={e => handlePointerDragStart(e, path)}
                onClick={() => onSelectFile(path)}
                className="w-full px-2 py-1.5 text-left hover:bg-bg-200/50 transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <img
                    src={getMaterialIconUrl(path, 'file', false)}
                    alt=""
                    width={16}
                    height={16}
                    draggable={false}
                    className="shrink-0"
                    loading="lazy"
                    decoding="async"
                    onError={e => {
                      e.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                  <span className="truncate text-[length:var(--fs-sm)] text-text-200">{name}</span>
                </div>
                <div className="mt-0.5 truncate pl-[22px] text-[length:var(--fs-xxs)] text-text-500">{path}</div>
              </button>
            )
          })}
        </>
      )}
      {hasText && (
        <>
          {hasFiles && (
            <div className="mt-1 px-2 py-1 text-[length:var(--fs-xxs)] font-medium text-text-500 uppercase tracking-wide">
              {t('fileExplorer.contentMatches')}
            </div>
          )}
          {results.map((match, index) => {
            const path = match.path.text
            const name = path.split(/[/\\]/).pop() || path
            const line = match.lines.text.trim()

            return (
              <button
                key={`${path}:${match.line_number}:${match.absolute_offset}:${index}`}
                type="button"
                onPointerDown={e => handlePointerDragStart(e, path)}
                onClick={() => onSelect(match)}
                className="w-full px-2 py-1.5 text-left hover:bg-bg-200/50 transition-colors"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <img
                    src={getMaterialIconUrl(path, 'file', false)}
                    alt=""
                    width={16}
                    height={16}
                    draggable={false}
                    className="shrink-0"
                    loading="lazy"
                    decoding="async"
                    onError={e => {
                      e.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                  <span className="truncate text-[length:var(--fs-sm)] text-text-200">{name}</span>
                  <span className="shrink-0 text-[length:var(--fs-xxs)] text-text-500">:{match.line_number}</span>
                </div>
                <div className="mt-0.5 truncate pl-[22px] font-mono text-[length:var(--fs-xxs)] text-text-400">{line}</div>
                <div className="mt-0.5 truncate pl-[22px] text-[length:var(--fs-xxs)] text-text-500">{path}</div>
              </button>
            )
          })}
        </>
      )}
      {isLoading && (
        <div className="px-2 py-1.5 text-center text-[length:var(--fs-xs)] text-text-500">{t('common:loading')}</div>
      )}
    </div>
  )
})
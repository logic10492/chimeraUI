// ============================================
// File Preview
// ============================================

import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CodePreview } from './CodePreview'
import { PreviewTabsBar, type PreviewTabsBarItem } from './PreviewTabsBar'
import { useFullscreenLayer } from '../contexts/useFullscreen'
import { detectLanguage } from '../utils/languageUtils'
import {
  getPreviewCategory,
  isBinaryContent,
  isTextualMedia,
  buildDataUrl,
  buildTextDataUrl,
  decodeBase64Text,
} from '../utils/mimeUtils'
import { downloadFileContent } from '../utils/downloadUtils'
import { DownloadIcon, MaximizeIcon, AlertCircleIcon } from './Icons'
import { isMarkdownPreview } from './FileExplorer.utils'
import { MediaPreview } from './FileExplorerMediaPreview'
import { BinaryPlaceholder } from './FileExplorerBinaryPlaceholder'
import { TextMediaPreview } from './FileExplorerTextMediaPreview'
import { MarkdownFilePreview } from './FileExplorerMarkdownFilePreview'
import type { FilePreviewProps } from './FileExplorer.types'

export function FilePreview({
  previewFiles,
  path,
  targetLine,
  targetKey,
  targetRanges,
  content,
  isLoading,
  error,
  onClose,
  onActivatePreview,
  onClosePreview,
  onReorderPreview,
  isResizing = false,
}: FilePreviewProps) {
  const { t } = useTranslation(['components', 'common'])
  const scrollRef = useRef<HTMLDivElement>(null)

  // 获取文件名
  const fileName = path?.split(/[/\\]/).pop() || 'Untitled'
  const language = path ? detectLanguage(path) : 'text'

  // 下载当前文件
  const handleDownload = useCallback(() => {
    if (content) {
      downloadFileContent(content, fileName)
    }
  }, [content, fileName])

  const previewTabItems = useMemo<PreviewTabsBarItem[]>(
    () =>
      previewFiles.map(file => ({
        id: file.path,
        title: file.path,
        closeTitle: `${t('common:close')} ${file.name}`,
        iconPath: file.path,
        label: <span className="block whitespace-nowrap text-[length:var(--fs-xs)] font-mono">{file.name}</span>,
      })),
    [previewFiles, t],
  )

  // 处理内容类型分发
  const displayContent = useMemo(() => {
    if (!content) return null

    const category = getPreviewCategory(content.mimeType)

    if (isMarkdownPreview(language, content.mimeType)) {
      const text = isBinaryContent(content.encoding) ? decodeBase64Text(content.content) : content.content
      return {
        type: 'markdown' as const,
        text,
      }
    }

    // 文本型可渲染媒体（如 SVG）— 同时提供渲染和源码
    // 优先级最高：即使以 base64 传输，也支持解码为文本查看
    if (isTextualMedia(content.mimeType)) {
      const isBase64 = isBinaryContent(content.encoding)
      const text = isBase64 ? decodeBase64Text(content.content) : content.content
      const dataUrl = isBase64
        ? buildDataUrl(content.mimeType!, content.content)
        : buildTextDataUrl(content.mimeType!, content.content)
      return {
        type: 'textMedia' as const,
        text,
        dataUrl,
        category: category!,
        mimeType: content.mimeType!,
      }
    }

    // 二进制 + 可预览的媒体类型
    if (isBinaryContent(content.encoding) && category) {
      return {
        type: 'media' as const,
        category,
        dataUrl: buildDataUrl(content.mimeType!, content.content),
        mimeType: content.mimeType!,
      }
    }

    // 二进制 + 不可预览
    if (isBinaryContent(content.encoding)) {
      return {
        type: 'binary' as const,
        mimeType: content.mimeType || 'application/octet-stream',
      }
    }

    // diff 渲染交给 Changes 面板，Files 预览只显示文件内容
    // if (content.patch && content.patch.hunks.length > 0) {
    //   return {
    //     type: 'diff' as const,
    //     hunks: content.patch.hunks,
    //   }
    // }

    // 显示文件内容
    return {
      type: 'text' as const,
      text: content.content,
    }
  }, [content, language])

  // 全屏内容
  const fullscreenContent = useMemo((): ReactNode => {
    if (!displayContent) return null
    switch (displayContent.type) {
      case 'media':
        return (
          <MediaPreview
            category={displayContent.category}
            dataUrl={displayContent.dataUrl}
            mimeType={displayContent.mimeType}
            fileName={fileName}
          />
        )
      case 'binary':
        return <BinaryPlaceholder mimeType={displayContent.mimeType} fileName={fileName} onDownload={handleDownload} />
      case 'textMedia':
        return (
          <TextMediaPreview
            key={targetKey ?? path ?? fileName}
            dataUrl={displayContent.dataUrl}
            text={displayContent.text}
            language={language || 'xml'}
            fileName={fileName}
            isResizing={false}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        )
      case 'markdown':
        return (
          <MarkdownFilePreview
            key={targetKey ?? path ?? fileName}
            text={displayContent.text}
            isResizing={false}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        )
      case 'text':
        return (
          <CodePreview
            code={displayContent.text}
            language={language || 'text'}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        )
      default:
        return null
    }
  }, [displayContent, fileName, handleDownload, language, path, targetKey, targetLine, targetRanges])

  const fullscreenHeaderRight = useMemo(
    () =>
      content ? (
        <button
          onClick={handleDownload}
          className="p-1.5 text-text-400 hover:text-text-100 hover:bg-bg-200/60 rounded-lg transition-colors"
          title={`${t('common:save')} ${fileName}`}
        >
          <DownloadIcon size={14} />
        </button>
      ) : null,
    [content, fileName, handleDownload, t],
  )

  const fullscreenLayer = useMemo(
    () =>
      fullscreenContent
        ? {
            id: `file-preview:${path || fileName}`,
            title: fileName,
            headerRight: fullscreenHeaderRight,
            content: fullscreenContent,
          }
        : null,
    [fileName, fullscreenContent, fullscreenHeaderRight, path],
  )
  const { open: openFullscreen } = useFullscreenLayer(fullscreenLayer)

  return (
    <div className="flex flex-col h-full relative">
      <PreviewTabsBar
        items={previewTabItems}
        activeId={path}
        closeAllTitle={t('common:closeAllTabs')}
        onActivate={onActivatePreview}
        onClose={onClosePreview}
        onCloseAll={onClose}
        onReorder={onReorderPreview}
        tabWidthClassName="w-auto max-w-none min-w-max"
        rightActions={
          content ? (
            <>
              <button
                onClick={openFullscreen}
                className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-300/50 rounded transition-colors"
                title={t('contentBlock.fullscreen')}
              >
                <MaximizeIcon size={12} />
              </button>
              <button
                onClick={handleDownload}
                className="p-1 text-text-400 hover:text-text-100 hover:bg-bg-300/50 rounded transition-colors"
                title={`${t('common:save')} ${fileName}`}
              >
                <DownloadIcon size={12} />
              </button>
            </>
          ) : null
        }
      />

      {/* Preview Content */}
      <div ref={scrollRef} className="flex-1 overflow-auto panel-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
            {t('common:loading')}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-danger-100 text-[length:var(--fs-sm)] gap-1 px-4">
            <AlertCircleIcon size={16} />
            <span className="text-center">{error}</span>
          </div>
        ) : displayContent?.type === 'media' ? (
          <MediaPreview
            category={displayContent.category}
            dataUrl={displayContent.dataUrl}
            mimeType={displayContent.mimeType}
            fileName={fileName}
          />
        ) : displayContent?.type === 'binary' ? (
          <BinaryPlaceholder mimeType={displayContent.mimeType} fileName={fileName} onDownload={handleDownload} />
        ) : displayContent?.type === 'textMedia' ? (
          <TextMediaPreview
            key={targetKey ?? path ?? fileName}
            dataUrl={displayContent.dataUrl}
            text={displayContent.text}
            language={language || 'xml'}
            fileName={fileName}
            isResizing={isResizing}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        ) : displayContent?.type === 'markdown' ? (
          <MarkdownFilePreview
            key={targetKey ?? path ?? fileName}
            text={displayContent.text}
            isResizing={isResizing}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        ) : // diff 渲染已移至 Changes 面板
        // ) : displayContent?.type === 'diff' ? (
        //   <DiffPreview hunks={displayContent.hunks} isResizing={isResizing} />
        displayContent?.type === 'text' ? (
          <CodePreview
            code={displayContent.text}
            language={language || 'text'}
            isResizing={isResizing}
            targetLine={targetLine}
            targetKey={targetKey}
            targetRanges={targetRanges}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)]">
            {t('common:noContent')}
          </div>
        )}
      </div>
    </div>
  )
}
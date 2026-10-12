// ============================================
// FileExplorer - 文件浏览器组件
// 包含文件树和文件预览两个区域，支持拖拽调整高度
// 性能优化：使用 CSS 变量 + requestAnimationFrame 处理 resize
// ============================================

import { memo, useCallback, useMemo, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileExplorer, type FileTreeNode } from '../hooks/useFileExplorer'
import { useVerticalSplitResize } from '../hooks/useVerticalSplitResize'
import { layoutStore } from '../store/layoutStore'
import { ChevronRightIcon, ChevronDownIcon, RetryIcon, AlertCircleIcon, SearchIcon, CloseIcon } from './Icons'
import { getMaterialIconUrl } from '../utils/materialIcons'
import { searchText, searchFiles } from '../api/file'
import type { TextSearchMatch } from '../api/types'
import { startInternalDrag } from '../lib/internalDragCore'
import { toAbsolutePath } from '../features/mention/utils'
import type { FileExplorerProps, TextSearchResultsProps, FileTreeItemProps } from './FileExplorer.types'
import { getSearchMatchRanges, MIN_TREE_HEIGHT, MIN_PREVIEW_HEIGHT } from './FileExplorer.utils'
import { FilePreview } from './FileExplorerFilePreview'

export { DiffPreview } from './FileExplorerDiffPreview'

export const FileExplorer = memo(function FileExplorer({
  panelTabId,
  directory,
  previewFile,
  previewFiles,
  position = 'right',
  isPanelResizing = false,
  sessionId,
}: FileExplorerProps) {
  const { t } = useTranslation(['components', 'common'])
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const searchRequestIdRef = useRef(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TextSearchMatch[]>([])
  const [fileResults, setFileResults] = useState<string[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const {
    splitHeight: treeHeight,
    isResizing,
    resetSplitHeight,
    handleResizeStart,
    handleTouchResizeStart,
  } = useVerticalSplitResize({
    containerRef,
    primaryRef: treeRef,
    cssVariableName: '--tree-height',
    minPrimaryHeight: MIN_TREE_HEIGHT,
    minSecondaryHeight: MIN_PREVIEW_HEIGHT,
  })

  // 综合 resize 状态 - 外部面板 resize 或内部 resize
  const isAnyResizing = isPanelResizing || isResizing

  const {
    tree,
    isLoading,
    error,
    expandedPaths,
    toggleExpand,
    previewContent,
    previewLoading,
    previewError,
    loadPreview,
    clearPreview,
    fileStatus,
    refresh,
  } = useFileExplorer({ directory, autoLoad: true, sessionId: sessionId || undefined, consumerId: `file-explorer-${panelTabId}` })

  // 当 previewFile 改变时加载预览
  useEffect(() => {
    if (previewFile) {
      loadPreview(previewFile.path)
    } else {
      clearPreview()
    }
  }, [previewFile, loadPreview, clearPreview])

  const handleRefresh = useCallback(async () => {
    await refresh()
    if (previewFile) {
      await loadPreview(previewFile.path)
    }
  }, [loadPreview, previewFile, refresh])

  // 处理文件点击
  const handleFileClick = useCallback(
    (node: FileTreeNode) => {
      if (node.type === 'directory') {
        toggleExpand(node.path)
      } else {
        layoutStore.openFilePreview({ path: node.path, name: node.name }, position)
      }
    },
    [toggleExpand, position],
  )

  // 关闭预览
  const handleClosePreview = useCallback(() => {
    layoutStore.closeAllFilePreviews(panelTabId)
    resetSplitHeight()
  }, [panelTabId, resetSplitHeight])

  const handleActivatePreview = useCallback(
    (path: string) => {
      layoutStore.activateFilePreview(panelTabId, path)
    },
    [panelTabId],
  )

  const handleClosePreviewTab = useCallback(
    (path: string) => {
      layoutStore.closeFilePreview(panelTabId, path)
    },
    [panelTabId],
  )

  const handleReorderPreviewTabs = useCallback(
    (draggedPath: string, targetPath: string) => {
      layoutStore.reorderFilePreviews(panelTabId, draggedPath, targetPath)
    },
    [panelTabId],
  )

  // 是否显示预览
  const showPreview = Boolean(previewFile) || previewLoading || Boolean(previewError)
  const trimmedSearchQuery = searchQuery.trim()
  const isSearchingText = trimmedSearchQuery.length > 0

  useEffect(() => {
    if (!directory || !trimmedSearchQuery) {
      searchRequestIdRef.current += 1
      return
    }

    const requestId = ++searchRequestIdRef.current
    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      setSearchResults([])
      setFileResults([])
      setSearchError(null)

      let fileDone = false
      let textDone = false
      const maybeFinish = () => {
        if (fileDone && textDone && requestId === searchRequestIdRef.current) {
          setSearchLoading(false)
        }
      }

      // 文件名搜索（失败静默，不阻断内容搜索）
      searchFiles(trimmedSearchQuery, { directory, limit: 50 })
        .then(paths => {
          if (requestId !== searchRequestIdRef.current) return
          setFileResults(paths)
        })
        .catch(() => {
          // 文件名搜索失败不报错
        })
        .finally(() => {
          fileDone = true
          maybeFinish()
        })

      // 内容搜索
      searchText(trimmedSearchQuery, directory)
        .then(results => {
          if (requestId !== searchRequestIdRef.current) return
          setSearchResults(results)
        })
        .catch(err => {
          if (requestId !== searchRequestIdRef.current) return
          setSearchResults([])
          setSearchError(err instanceof Error ? err.message : t('fileExplorer.textSearchFailed'))
        })
        .finally(() => {
          textDone = true
          maybeFinish()
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [directory, trimmedSearchQuery, t])

  const handleSearchResultClick = useCallback(
    (match: TextSearchMatch) => {
      const path = match.path.text
      const name = path.split(/[/\\]/).pop() || path
      layoutStore.openFilePreview(
        {
          path,
          name,
          targetLine: match.line_number,
          targetKey: `${path}:${match.line_number}:${match.absolute_offset}:${Date.now()}`,
          targetRanges: getSearchMatchRanges(match),
        },
        position,
      )
    },
    [position],
  )

  const handleFileResultClick = useCallback(
    (path: string) => {
      const name = path.split(/[/\\]/).pop() || path
      layoutStore.openFilePreview({ path, name }, position)
    },
    [position],
  )

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (!value.trim()) {
      setSearchResults([])
      setFileResults([])
      setSearchLoading(false)
      setSearchError(null)
    }
  }, [])

  // 没有选择目录
  if (!directory) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-base)] gap-2 p-4">
        <img
          src={getMaterialIconUrl('folder', 'directory', false)}
          alt=""
          width={32}
          height={32}
          className="opacity-30"
          onError={e => {
            e.currentTarget.style.visibility = 'hidden'
          }}
        />
        <span className="text-center">{t('fileExplorer.selectProject')}</span>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* File Tree - 使用 CSS 变量控制高度 */}
      <div
        ref={treeRef}
        className="overflow-hidden flex flex-col shrink-0"
        style={
          {
            '--tree-height': treeHeight !== null ? `${treeHeight}px` : '40%',
            height: showPreview ? 'var(--tree-height)' : '100%',
            minHeight: showPreview ? MIN_TREE_HEIGHT : undefined,
          } as React.CSSProperties
        }
      >
        {/* Tree Header */}
        <div className="relative flex h-10 items-center gap-2 px-3 shrink-0">
          <div className="relative group min-w-0 flex-1">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-400 w-3.5 h-3.5 group-focus-within:text-accent-main-100 transition-colors" />
            <input
              type="text"
              name="file-explorer-text-search"
              value={searchQuery}
              onChange={e => handleSearchQueryChange(e.target.value)}
              placeholder={t('fileExplorer.searchFiles')}
              aria-label={t('fileExplorer.searchFiles')}
              autoComplete="off"
              className="w-full bg-bg-200/40 hover:bg-bg-200/60 focus:bg-bg-000 border border-transparent focus:border-border-200 rounded-lg py-1 pl-[30px] pr-7 text-[length:var(--fs-xs)] text-text-100 placeholder:text-text-400/70 focus-visible:ring-1 focus-visible:ring-border-200 focus-visible:ring-inset transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchQueryChange('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center text-text-400 hover:text-text-100 rounded transition-colors"
                aria-label={t('fileExplorer.clearSearch')}
                title={t('fileExplorer.clearSearch')}
              >
                <CloseIcon size={12} />
              </button>
            )}
          </div>
          <span className="inline-flex h-6 items-center text-[length:var(--fs-xs)] font-medium text-text-100">
            {t('fileExplorer.explorer')}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            aria-label={t('common:refresh')}
            className="inline-flex h-6 w-6 items-center justify-center text-text-400 hover:text-text-100 hover:bg-bg-200/50 rounded-md transition-colors disabled:opacity-50"
            title={t('common:refresh')}
          >
            <RetryIcon size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
        </div>

        {/* Tree Content */}
        <div className="flex-1 overflow-auto panel-scrollbar-y">
          {isSearchingText ? (
            <TextSearchResults
              results={searchResults}
              fileResults={fileResults}
              isLoading={searchLoading}
              error={searchError}
              onSelect={handleSearchResultClick}
              onSelectFile={handleFileResultClick}
              directory={directory}
            />
          ) : isLoading && tree.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-text-400 text-[length:var(--fs-sm)]">
              {t('common:loading')}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-20 text-danger-100 text-[length:var(--fs-sm)] gap-1 px-4">
              <AlertCircleIcon size={16} />
              <span className="text-center">{error}</span>
            </div>
          ) : tree.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-text-400 text-[length:var(--fs-sm)]">
              {t('fileExplorer.noFilesFound')}
            </div>
          ) : (
            <div className="py-1">
              {tree.map(node => (
                <FileTreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  expandedPaths={expandedPaths}
                  fileStatus={fileStatus}
                  onClick={handleFileClick}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Resize Handle - 与标签栏同色 */}
      {showPreview && (
        <div
          className={`
            h-1.5 cursor-row-resize shrink-0 relative
            hover:bg-accent-main-100/50 active:bg-accent-main-100 transition-colors
            ${isResizing ? 'bg-accent-main-100' : 'bg-bg-200/60'}
          `}
          onMouseDown={handleResizeStart}
          onTouchStart={handleTouchResizeStart}
        />
      )}

      {/* Preview Area */}
      {showPreview && (
        <div className="flex-1 flex flex-col min-h-0" style={{ minHeight: MIN_PREVIEW_HEIGHT }}>
          <FilePreview
            previewFiles={previewFiles}
            path={previewFile?.path ?? null}
            targetLine={previewFile?.targetLine}
            targetKey={previewFile?.targetKey}
            targetRanges={previewFile?.targetRanges}
            content={previewContent}
            isLoading={previewLoading}
            error={previewError}
            onClose={handleClosePreview}
            onActivatePreview={handleActivatePreview}
            onClosePreview={handleClosePreviewTab}
            onReorderPreview={handleReorderPreviewTabs}
            isResizing={isAnyResizing}
          />
        </div>
      )}
    </div>
  )
})

const TextSearchResults = memo(function TextSearchResults({
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

// ============================================
// File Tree Item
// ============================================

const FileTreeItem = memo(function FileTreeItem({
  node,
  depth,
  expandedPaths,
  fileStatus,
  onClick,
}: FileTreeItemProps) {
  const isExpanded = expandedPaths.has(node.path)
  const isDirectory = node.type === 'directory'
  // node.path 可能用反斜杠（Windows），statusMap key 统一用正斜杠
  const status = fileStatus.get(node.path) || fileStatus.get(node.path.replace(/\\/g, '/'))

  // 状态颜色
  const statusColor = useMemo(() => {
    if (!status) return null
    switch (status.status) {
      case 'added':
        return 'text-success-100'
      case 'modified':
        return 'text-warning-100'
      case 'deleted':
        return 'text-danger-100'
      default:
        return null
    }
  }, [status])

  // 拖拽到输入框实现 @mention。使用 pointer 拖拽，避免 Tauri 原生文件 drop 接管 HTML5 DnD。
  const handlePointerDragStart = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const fileData = {
        type: (isDirectory ? 'folder' : 'file') as 'file' | 'folder',
        path: node.path, // 相对路径
        absolute: node.absolute, // 绝对路径
        name: node.name,
      }
      startInternalDrag(e, { kind: 'file-mention', file: fileData })
    },
    [node.path, node.absolute, node.name, isDirectory],
  )

  return (
    <div>
      <button
        onPointerDown={handlePointerDragStart}
        onClick={() => onClick(node)}
        className={`
          w-full flex items-center gap-1 px-2 py-0.5 text-left cursor-default
          select-none hover:bg-bg-200/50 transition-colors text-[length:var(--fs-sm)]
          text-text-300
          ${node.ignored ? 'opacity-50' : ''}
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Expand/Collapse Icon */}
        {isDirectory ? (
          <span className="w-4 h-4 flex items-center justify-center text-text-400 shrink-0">
            {isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* File/Folder Icon - Material Icon Theme */}
        <img
          src={getMaterialIconUrl(node.path, isDirectory ? 'directory' : 'file', isExpanded)}
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

        {/* Name */}
        <span className={`truncate flex-1 ${statusColor || ''}`}>{node.name}</span>

        {/* Loading Indicator */}
        {node.isLoading && (
          <span className="w-3 h-3 border border-text-400 border-t-transparent rounded-full animate-spin shrink-0" />
        )}
      </button>

      {/* Children */}
      {isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              fileStatus={fileStatus}
              onClick={onClick}
            />
          ))}
        </div>
      )}
    </div>
  )
})

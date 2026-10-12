import { memo, useCallback, useMemo, type PointerEvent } from 'react'
import { ChevronRightIcon, ChevronDownIcon } from './Icons'
import { getMaterialIconUrl } from '../utils/materialIcons'
import { startInternalDrag } from '../lib/internalDragCore'
import type { FileTreeItemProps } from './FileExplorer.types'

export const FileTreeItem = memo(function FileTreeItem({
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
import type { FileTreeNode } from '../hooks/useFileExplorer'
import type { PreviewFile } from '../store/layoutStore'
import type { FileContent, TextSearchMatch } from '../api/types'
import type { TargetLineRange } from './codeMirrorReadonlyExtensions'
import type { PreviewCategory } from '../utils/mimeUtils'

export interface FileExplorerProps {
  panelTabId: string
  directory?: string
  previewFile: PreviewFile | null
  previewFiles: PreviewFile[]
  position?: 'bottom' | 'right'
  isPanelResizing?: boolean
  sessionId?: string | null
}

export interface TextSearchResultsProps {
  results: TextSearchMatch[]
  fileResults: string[]
  isLoading: boolean
  error: string | null
  onSelect: (match: TextSearchMatch) => void
  onSelectFile: (path: string) => void
  directory?: string
}

export interface FileTreeItemProps {
  node: FileTreeNode
  depth: number
  expandedPaths: Set<string>
  fileStatus: Map<string, { status: string }>
  onClick: (node: FileTreeNode) => void
}

export interface FilePreviewProps {
  previewFiles: PreviewFile[]
  path: string | null
  targetLine?: number
  targetKey?: string
  targetRanges?: readonly TargetLineRange[]
  content: FileContent | null
  isLoading: boolean
  error: string | null
  onClose: () => void
  onActivatePreview: (path: string) => void
  onClosePreview: (path: string) => void
  onReorderPreview: (draggedPath: string, targetPath: string) => void
  isResizing?: boolean
}

export interface MediaPreviewProps {
  category: PreviewCategory
  dataUrl: string
  mimeType: string
  fileName: string
}

export interface ImagePreviewProps {
  dataUrl: string
  fileName: string
}

export interface TextMediaPreviewProps {
  dataUrl: string
  text: string
  language: string
  fileName: string
  isResizing?: boolean
  targetLine?: number
  targetKey?: string
  targetRanges?: readonly TargetLineRange[]
}

export interface MarkdownFilePreviewProps {
  text: string
  isResizing?: boolean
  targetLine?: number
  targetKey?: string
  targetRanges?: readonly TargetLineRange[]
}

export interface BinaryPlaceholderProps {
  mimeType: string
  fileName: string
  onDownload?: () => void
}

export interface DiffPreviewProps {
  hunks: Array<{
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    lines: string[]
  }>
  isResizing?: boolean
}
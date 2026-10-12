/**
 * DiffViewer - 核心 Diff 渲染组件
 *
 * 两列架构（和 CodePreview 一致）：
 * - Gutter 列：change bar（3px 竖条，增绿删红）+ 行号，固定不水平滚动
 * - Content 列：代码内容，独立水平滚动
 *
 * 默认使用虚拟滚动；启用自动换行后切到 wrapped 渲染
 * 不再按文件大小、行数、字符数降级高亮或 diff
 *
 * 批次 ④ 后本文件只保留公开编排壳（DiffViewer / DiffViewerWithData + re-export）。
 * 具体渲染容器拆分至：
 * - DiffViewerContent（按 viewMode/wordWrap 选择）
 * - DiffViewerSplitView（SplitDiffView / WrappedSplitDiffView）
 * - DiffViewerUnifiedView（UnifiedDiffView / WrappedUnifiedDiffView）
 */

import { memo } from 'react'
import { useDiffViewerData } from './DiffViewer.hooks'
import type { DiffViewerProps } from './DiffViewer.types'
import { DiffViewerContent } from './DiffViewerContent'

export type { ViewMode, DiffViewerProps, DiffViewerData, LineType } from './DiffViewer.types'
// eslint-disable-next-line react-refresh/only-export-components -- DiffViewer consumers share this data with fullscreen instances.
export { useDiffViewerData } from './DiffViewer.hooks'

// ============================================
// Main Component
// ============================================

export const DiffViewer = memo(function DiffViewer({
  data,
  ...props
}: DiffViewerProps) {
  if (data) return <DiffViewerContent {...props} data={data} />
  return <DiffViewerWithData {...props} />
})

function DiffViewerWithData({ before, after, language = 'text', isResizing = false, ...props }: DiffViewerProps) {
  const data = useDiffViewerData(before, after, language, isResizing)
  return <DiffViewerContent before={before} after={after} language={language} isResizing={isResizing} {...props} data={data} />
}
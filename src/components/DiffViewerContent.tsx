/**
 * DiffViewerContent - Diff 渲染编排壳。
 *
 * 拆自 DiffViewer.tsx（批次 ④）。按 viewMode/wordWrap 在四个视图容器之间选择；
 * 数据经 props 显式传入（DiffViewerData 由调用方或 DiffViewerWithData 派生）。
 */

import { memo, useSyncExternalStore } from 'react'
import { themeStore } from '../store/themeStore'
import { codeLineHeight } from './DiffViewer.utils'
import type { DiffViewerData, DiffViewerProps } from './DiffViewer.types'
import { SplitDiffView, WrappedSplitDiffView } from './DiffViewerSplitView'
import { UnifiedDiffView, WrappedUnifiedDiffView } from './DiffViewerUnifiedView'

export const DiffViewerContent = memo(function DiffViewerContent({
  before,
  after,
  viewMode = 'split',
  maxHeight,
  isResizing = false,
  wordWrap,
  data,
  stateKey,
}: DiffViewerProps & { data: DiffViewerData }) {
  const { diffStyle, codeWordWrap, codeFontScale } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = wordWrap ?? codeWordWrap
  const lineHeight = codeLineHeight(codeFontScale)
  const resolvedData = data

  // 纯增加或纯删除时，split 模式另一边是空的没意义，自动降级为 unified
  const isAddOnly = !before.trim()
  const isDeleteOnly = !after.trim()
  const effectiveViewMode = isAddOnly || isDeleteOnly ? 'unified' : viewMode

  if (effectiveViewMode === 'split') {
    if (resolvedWordWrap) {
      return (
        <WrappedSplitDiffView
          beforeTokens={resolvedData.beforeTokens}
          afterTokens={resolvedData.afterTokens}
          pairedLines={resolvedData.pairedLines}
          lineNumberWidth={resolvedData.lineNumberWidth}
          isResizing={isResizing}
          maxHeight={maxHeight}
          diffStyle={diffStyle}
          lineHeight={lineHeight}
          stateKey={stateKey ? `${stateKey}:wrapped-split` : undefined}
        />
      )
    }

    return (
      <SplitDiffView
        beforeTokens={resolvedData.beforeTokens}
        afterTokens={resolvedData.afterTokens}
        pairedLines={resolvedData.pairedLines}
        lineNumberWidth={resolvedData.lineNumberWidth}
        isResizing={isResizing}
        maxHeight={maxHeight}
        diffStyle={diffStyle}
        lineHeight={lineHeight}
        stateKey={stateKey ? `${stateKey}:split` : undefined}
      />
    )
  }

  if (resolvedWordWrap) {
    return (
      <WrappedUnifiedDiffView
        beforeTokens={resolvedData.beforeTokens}
        afterTokens={resolvedData.afterTokens}
        lines={resolvedData.unifiedLines}
        lineNumberWidth={resolvedData.lineNumberWidth}
        isResizing={isResizing}
        maxHeight={maxHeight}
        diffStyle={diffStyle}
        lineHeight={lineHeight}
        stateKey={stateKey ? `${stateKey}:wrapped-unified` : undefined}
      />
    )
  }

  return (
    <UnifiedDiffView
      beforeTokens={resolvedData.beforeTokens}
      afterTokens={resolvedData.afterTokens}
      lines={resolvedData.unifiedLines}
      lineNumberWidth={resolvedData.lineNumberWidth}
      isResizing={isResizing}
      maxHeight={maxHeight}
      diffStyle={diffStyle}
      lineHeight={lineHeight}
      stateKey={stateKey ? `${stateKey}:unified` : undefined}
    />
  )
})
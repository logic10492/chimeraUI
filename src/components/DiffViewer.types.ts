import type { diffWordsWithSpace } from 'diff'
import type { HighlightTokens } from '../hooks/useSyntaxHighlight'

export type ViewMode = 'split' | 'unified'

export interface DiffViewerProps {
  before: string
  after: string
  language?: string
  viewMode?: ViewMode
  /** 不传则填满父容器 */
  maxHeight?: number
  isResizing?: boolean
  wordWrap?: boolean
  data?: DiffViewerData
  /** Stable key for preserving expanded collapsed-context regions across remounts. */
  stateKey?: string
}

export interface DiffViewerData {
  beforeTokens: HighlightTokens | null
  afterTokens: HighlightTokens | null
  pairedLines: PairedLine[]
  unifiedLines: UnifiedLine[]
  lineNumberWidth: number
}

export type LineType = 'add' | 'delete' | 'context' | 'empty'

export interface DiffLine {
  type: LineType
  content: string
  lineNo?: number
  /** 词级别 diff 标记（结构化），与 syntax token 共存 */
  wordDiffSegments?: WordDiffSegment[]
}

/** 词级别 diff 的单个片段 */
export interface WordDiffSegment {
  text: string
  /** 'add' | 'delete' 表示增删标记，undefined 表示无变化 */
  diffType?: 'add' | 'delete'
}

export interface PairedLine {
  left: DiffLine
  right: DiffLine
}

/** 折叠的 context 行占位 */
export interface CollapsedPairedLine {
  collapsed: true
  count: number
  /** 在原始 lines 数组中的起始索引，用于展开 */
  id: number
  isFirst: boolean
  isLast: boolean
  chunked: boolean
}

export type PairedLineOrCollapsed = PairedLine | CollapsedPairedLine

export interface UnifiedLine extends DiffLine {
  oldLineNo?: number
  newLineNo?: number
}

export interface CollapsedUnifiedLine {
  collapsed: true
  count: number
  id: number
  isFirst: boolean
  isLast: boolean
  chunked: boolean
}

export type UnifiedLineOrCollapsed = UnifiedLine | CollapsedUnifiedLine

export type ExpandDirection = 'up' | 'down' | 'both'

export interface ExpansionRegion {
  fromStart: number
  fromEnd: number
}

export type HighlightToken = HighlightTokens[number][number]
export type WordDiffChange = ReturnType<typeof diffWordsWithSpace>[number]
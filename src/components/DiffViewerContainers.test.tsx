import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiffViewerContent } from './DiffViewerContent'
import { SplitDiffView } from './DiffViewerSplitView'
import { UnifiedDiffView } from './DiffViewerUnifiedView'
import type { DiffViewerData, PairedLine, UnifiedLine } from './DiffViewer.types'

vi.mock('../store/themeStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/themeStore')>()
  const snapshot = { diffStyle: 'lineNumbers' as const, codeWordWrap: false, codeFontScale: 0 }
  return {
    ...actual,
    themeStore: {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    },
  }
})

const pairedLines: PairedLine[] = [
  { left: { type: 'context', content: 'unchanged ctx', lineNo: 1 }, right: { type: 'context', content: 'unchanged ctx', lineNo: 1 } },
  { left: { type: 'delete', content: 'old split line', lineNo: 2 }, right: { type: 'add', content: 'new split line', lineNo: 2 } },
]

const unifiedLines: UnifiedLine[] = [
  { type: 'context', content: 'unchanged unified', oldLineNo: 1, newLineNo: 1 },
  { type: 'delete', content: 'removed unified line', oldLineNo: 2 },
  { type: 'add', content: 'added unified line', newLineNo: 2 },
]

function makeData(): DiffViewerData {
  return { beforeTokens: null, afterTokens: null, pairedLines, unifiedLines, lineNumberWidth: 30 }
}

describe('DiffViewer containers (batch ④)', () => {
  it('SplitDiffView renders both paired sides with line content', () => {
    render(
      <SplitDiffView
        beforeTokens={null}
        afterTokens={null}
        pairedLines={pairedLines}
        lineNumberWidth={30}
        isResizing={false}
        diffStyle="lineNumbers"
        lineHeight={24}
      />,
    )

    expect(screen.getByText('old split line')).toBeInTheDocument()
    expect(screen.getByText('new split line')).toBeInTheDocument()
    expect(screen.getAllByText('unchanged ctx')).toHaveLength(2)
  })

  it('UnifiedDiffView renders unified lines with content', () => {
    render(
      <UnifiedDiffView
        beforeTokens={null}
        afterTokens={null}
        lines={unifiedLines}
        lineNumberWidth={30}
        isResizing={false}
        diffStyle="lineNumbers"
        lineHeight={24}
      />,
    )

    expect(screen.getByText('removed unified line')).toBeInTheDocument()
    expect(screen.getByText('added unified line')).toBeInTheDocument()
    expect(screen.getByText('unchanged unified')).toBeInTheDocument()
  })

  it('DiffViewerContent selects split rendering when both sides have content', () => {
    render(<DiffViewerContent before="a\nb" after="a\nc" viewMode="split" data={makeData()} />)

    expect(screen.getByText('old split line')).toBeInTheDocument()
    expect(screen.getByText('new split line')).toBeInTheDocument()
  })

  it('DiffViewerContent degrades add-only diffs to unified rendering', () => {
    render(<DiffViewerContent before="" after="added only" viewMode="split" data={makeData()} />)

    // add-only → unified；split 独有行不应渲染
    expect(screen.queryByText('old split line')).toBeNull()
    expect(screen.getByText('added unified line')).toBeInTheDocument()
  })
})
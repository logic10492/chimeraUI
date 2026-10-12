import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CollapsedExpandButton } from './DiffViewerCollapsedExpandButton'
import { CollapsedLabel } from './DiffViewerCollapsedLabel'
import { CollapsedBar } from './DiffViewerCollapsedBar'

const t = (key: string, opts?: Record<string, unknown>) => (opts?.count !== undefined ? `${key}:${opts.count}` : key)

describe('DiffViewer parts', () => {
  it('CollapsedExpandButton fires onExpand with the clicked direction', () => {
    const onExpand = vi.fn()
    const { container } = render(<CollapsedExpandButton directions={['up', 'down']} onExpand={onExpand} />)

    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(2)

    fireEvent.click(buttons[0])
    expect(onExpand).toHaveBeenCalledWith('up')

    fireEvent.click(buttons[1])
    expect(onExpand).toHaveBeenCalledWith('down')
  })

  it('CollapsedLabel renders the unchanged-lines text and expands both ways', () => {
    const onExpand = vi.fn()
    render(<CollapsedLabel count={7} t={t} onExpand={onExpand} />)

    const label = screen.getByText('diffViewer.linesUnchanged:7')
    expect(label).toBeInTheDocument()

    fireEvent.click(label)
    expect(onExpand).toHaveBeenCalledWith('both')
  })

  it('CollapsedBar renders the label and wires the expand buttons', () => {
    const onExpand = vi.fn()
    render(<CollapsedBar count={12} t={t} isFirst={true} isLast={false} chunked={false} onExpand={onExpand} lineNumberAreaWidth={40} />)

    expect(screen.getByText('diffViewer.linesUnchanged:12')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Expand downward'))
    expect(onExpand).toHaveBeenCalledWith('down')
  })
})
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PaneNode } from '../../store/paneLayoutStore'
import { SplitContainer } from './SplitContainer'

const root: PaneNode = {
  type: 'split',
  id: 'split-root',
  direction: 'horizontal',
  ratio: 0.5,
  first: { type: 'leaf', id: 'pane-a', sessionId: 'session-a' },
  second: { type: 'leaf', id: 'pane-b', sessionId: 'session-b' },
}

const renderLeaf = (paneId: string) => <textarea aria-label={paneId} defaultValue="" />

describe('SplitContainer', () => {
  it('keeps hidden sibling panes mounted while a focused pane is rendered fullscreen', () => {
    const { rerender } = render(<SplitContainer node={root} renderLeaf={renderLeaf} fullscreenPaneId="pane-b" />)
    const hiddenDraft = screen.getByRole('textbox', { name: 'pane-a' })
    const focusedDraft = screen.getByRole('textbox', { name: 'pane-b' })

    fireEvent.change(hiddenDraft, { target: { value: 'preserved draft' } })
    expect(hiddenDraft.parentElement).toHaveStyle({ width: '0px', height: '0px', contentVisibility: 'hidden' })

    rerender(<SplitContainer node={root} renderLeaf={renderLeaf} fullscreenPaneId={null} />)

    expect(screen.getByRole('textbox', { name: 'pane-a' })).toBe(hiddenDraft)
    expect(screen.getByRole('textbox', { name: 'pane-b' })).toBe(focusedDraft)
    expect(hiddenDraft).toHaveValue('preserved draft')
  })
})

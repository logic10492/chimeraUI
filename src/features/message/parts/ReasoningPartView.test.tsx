import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReasoningPartView } from './ReasoningPartView'
import type { ReasoningPart } from '../../../types/message'

let mockReasoningDisplayMode: 'italic' | 'markdown' | 'capsule' = 'italic'

vi.mock('../../../hooks/useDelayedRender', () => ({
  useDelayedRender: (show: boolean) => show,
}))
vi.mock('../../../hooks/useDisclosureScrollLock', () => ({
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
}))

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({ reasoningDisplayMode: mockReasoningDisplayMode }),
}))

vi.mock('../../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown-content">{content}</div>,
}))

describe('ReasoningPartView', () => {
  beforeEach(() => {
    mockReasoningDisplayMode = 'italic'
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 16),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows only the shimmering thinking label in the header while streaming raw reasoning in italic mode', () => {
    const part = {
      id: 'reason-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'thinking through steps...',
      time: { start: 1 },
    } as unknown as ReasoningPart

    const { container } = render(<ReasoningPartView part={part} isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    const header = screen.getByRole('button', { expanded: true })
    expect(header).toBeInTheDocument()
    // The shimmering header span carries only the streaming label, not the chain-of-thought text.
    const shimmerSpan = container.querySelector('.reasoning-shimmer-text')
    expect(shimmerSpan).not.toBeNull()
    expect(shimmerSpan).toHaveTextContent('Thinking...')
    expect(shimmerSpan).not.toHaveTextContent('thinking through steps...')
    // The live reasoning text still renders in the plain (non-shimmering) expanded body.
    const bodyText = screen.getAllByText('thinking through steps...')
    expect(bodyText.length).toBeGreaterThan(0)
    bodyText.forEach(node => expect(node).not.toHaveClass('reasoning-shimmer-text'))
    expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument()
  })

  it('treats explicit raw reasoning metadata like unmarked reasoning while streaming', () => {
    const part = {
      id: 'reason-raw',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'thinking through steps...',
      time: { start: 1 },
      metadata: { chimera: { reasoning: 'raw' } },
    } as unknown as ReasoningPart

    const { container } = render(<ReasoningPartView part={part} isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    const header = screen.getByRole('button', { expanded: true })
    expect(header).not.toHaveTextContent('thinking through steps...')
    const shimmerSpan = container.querySelector('.reasoning-shimmer-text')
    expect(shimmerSpan).toHaveTextContent('Thinking...')
    // Raw chain-of-thought still streams in the plain expanded body.
    expect(container.querySelector('.whitespace-pre-wrap')).toHaveTextContent('thinking through steps...')
  })

  it('keeps the latest summary text in the shimmering header while streaming summary reasoning', () => {
    const part = {
      id: 'reason-summary',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'summary of the reasoning',
      time: { start: 1 },
      metadata: { chimera: { reasoning: 'summary' } },
    } as unknown as ReasoningPart

    const { container } = render(<ReasoningPartView part={part} isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    const header = screen.getByRole('button', { expanded: true })
    expect(header).not.toHaveTextContent('Thinking...')
    const shimmerSpan = container.querySelector('.reasoning-shimmer-text')
    expect(shimmerSpan).toHaveTextContent('summary of the reasoning')
    expect(container.querySelector('.whitespace-pre-wrap')).toHaveTextContent('summary of the reasoning')
  })

  it('strips inline markdown markers from the shimmering summary header while streaming', () => {
    const part = {
      id: 'reason-summary-markdown',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: '**Reviewing the plan** next step',
      time: { start: 1 },
      metadata: { chimera: { reasoning: 'summary' } },
    } as unknown as ReasoningPart

    const { container } = render(<ReasoningPartView part={part} isStreaming={true} />)

    act(() => {
      vi.advanceTimersByTime(32)
    })

    const header = screen.getByRole('button', { expanded: true })
    const shimmerSpan = container.querySelector('.reasoning-shimmer-text')
    expect(shimmerSpan).not.toBeNull()
    expect(shimmerSpan).toHaveTextContent('Reviewing the plan next step')
    expect(header).not.toHaveTextContent('**')
    // The expanded body still receives the raw markdown text.
    expect(container.querySelector('.whitespace-pre-wrap')).toHaveTextContent('**Reviewing the plan** next step')
  })

  it('strips inline markdown markers from the collapsed preview', () => {
    const part = {
      id: 'reason-collapsed-markdown',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: '**Reviewing the plan**\nnext `step`',
      time: { start: 1, end: 100 },
      metadata: { chimera: { reasoning: 'summary' } },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    const header = screen.getByRole('button', { expanded: false })
    const contentSpan = header.querySelector('span.block')
    expect(contentSpan).toHaveTextContent('Reviewing the plan next step')
    expect(contentSpan).not.toHaveTextContent('**')
    expect(contentSpan).not.toHaveTextContent('`')
  })

  it.each([
    ['raw', { chimera: { reasoning: 'raw' } }],
    ['summary', { chimera: { reasoning: 'summary' } }],
  ])('keeps the non-streaming collapsed preview for %s reasoning', (label, metadata) => {
    const part = {
      id: `reason-done-${label}`,
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'first line\nsecond line',
      time: { start: 1, end: 100 },
      metadata,
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    const header = screen.getByRole('button', { expanded: false })
    const contentSpan = header.querySelector('span.block')
    expect(contentSpan).toHaveTextContent('first line second line')
    expect(contentSpan).not.toHaveClass('reasoning-shimmer-text')
    expect(header).not.toHaveTextContent('Thinking...')
  })

  it('renders markdown content in markdown reasoning mode', () => {
    mockReasoningDisplayMode = 'markdown'

    const part = {
      id: 'reason-2',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'Use **bold** and `code` here',
      time: { start: 1, end: 100 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    expect(screen.getByTestId('markdown-content')).toHaveTextContent('Use **bold** and `code` here')
  })

  it('renders single-line content without toggle button', () => {
    const part = {
      id: 'reason-3',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'reasoning',
      text: 'short',
      time: { start: 1, end: 100 },
    } as unknown as ReasoningPart

    render(<ReasoningPartView part={part} isStreaming={false} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getAllByText('short').length).toBeGreaterThan(0)
  })
})

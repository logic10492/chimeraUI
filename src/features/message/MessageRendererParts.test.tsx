import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CollapsibleUserText } from './MessageRendererCollapsibleUserText'
import { ForkActionButton } from './MessageRendererForkActionButton'
import type { Message } from '../../types/message'

vi.mock('motion/mini', () => ({
  animate: () => Promise.resolve(),
}))

vi.mock('../../hooks/useDisclosureScrollLock', () => ({
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
}))

vi.mock('../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="user-markdown">{content}</div>,
}))

function createAssistantMessage(): Message {
  return {
    info: {
      id: 'assistant-1',
      sessionID: 'session-1',
      role: 'assistant',
      parentID: 'user-1',
      modelID: 'model-1',
      providerID: 'provider-1',
      mode: 'chat',
      agent: 'build',
      path: { cwd: '/workspace', root: '/workspace' },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      time: { created: 1 },
    },
    parts: [],
    isStreaming: false,
  }
}

describe('MessageRendererParts', () => {
  it('ForkActionButton fires onFork with the message and the explicit fork target id', async () => {
    const onFork = vi.fn()
    const message = createAssistantMessage()

    render(<ForkActionButton message={message} onFork={onFork} forkMessageId="assistant-2" />)

    fireEvent.click(screen.getByRole('button', { name: /fork|分叉/i }))

    await waitFor(() => {
      expect(onFork).toHaveBeenCalledWith(message, 'assistant-2')
    })
  })

  it('CollapsibleUserText toggles the expand/collapse control for overflowing text', () => {
    const computedStyle = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ getPropertyValue: () => '16' } as unknown as CSSStyleDeclaration)
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 10000 })

    try {
      render(
        <CollapsibleUserText text="some long user text" collapseEnabled renderMarkdown={false} messageId="toggle-1" />,
      )

      const toggle = screen.getByRole('button')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(toggle)

      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    } finally {
      computedStyle.mockRestore()
      if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
    }
  })
})
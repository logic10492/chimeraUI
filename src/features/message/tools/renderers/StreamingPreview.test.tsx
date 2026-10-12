import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StreamingPreview } from './StreamingPreview'
import type { StreamingPreviewProps } from './StreamingPreview'
import type { StreamingHunk } from '../../../../types/message'
import { FullscreenProvider } from '../../../../contexts'

vi.mock('../../../../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: (code: string, options?: { mode?: 'html' | 'tokens' }) => ({
    output: options?.mode === 'tokens' ? code.split('\n').map(line => [{ content: line, color: '#fff' }]) : null,
    isLoading: false,
  }),
  useSyntaxHighlightRef: () => ({
    tokensRef: { current: null },
    version: 0,
  }),
}))

vi.mock('../../../../components/FullscreenViewer', () => ({
  FullscreenViewer: ({ isOpen, children }: { isOpen: boolean; children?: ReactNode }) =>
    isOpen ? <div data-testid="fullscreen-viewer">{children}</div> : null,
  ViewModeSwitch: () => <div data-testid="view-mode-switch">switch</div>,
}))

const HUNK_ONE: StreamingHunk = {
  index: 0,
  op: 'replace',
  filePath: 'src/domain/cart.ts',
  pos: '18#RQ',
  before: ['  get total(): number {', '    return this.items.reduce((sum, i) => sum + i.price * i.quantity, 0)', '  }'].join(
    '\n',
  ),
  after: [
    '  get total(): number {',
    '    const subtotal = this.items.reduce((sum, i) => sum + i.price * i.quantity, 0)',
    '    return roundCents(subtotal * (1 - this.discount))',
    '  }',
  ].join('\n'),
}

const HUNK_TWO: StreamingHunk = {
  index: 1,
  op: 'append',
  filePath: 'src/domain/cart.ts',
  pos: '42#VX',
  before: ['  remove(index: number): void {', '    this.items.splice(index, 1)', '  }'].join('\n'),
  after: [
    '  remove(index: number): void {',
    '    this.items.splice(index, 1)',
    '  }',
    '',
    '  applyDiscount(percent: number): void {',
    '    if (percent < 0 || percent > 100) throw new RangeError(percent)',
    '  }',
  ].join('\n'),
}

const HUNK_THREE: StreamingHunk = {
  index: 2,
  op: 'append',
  filePath: 'src/domain/cart.ts',
  pos: '7#KP',
  before: ['export class Cart {', '  private items: CartItem[] = []'].join('\n'),
  after: ['export class Cart {', '  private items: CartItem[] = []', '  private discount = 0'].join('\n'),
}

function renderPreview(props: Omit<StreamingPreviewProps, 'stateBaseKey' | 'fullscreenBaseId'>) {
  return render(
    <FullscreenProvider>
      <StreamingPreview stateBaseKey="test:streaming" fullscreenBaseId="test:streaming" {...props} />
    </FullscreenProvider>,
  )
}

describe('StreamingPreview', () => {
  it('renders only the growing preview card when there are no hunks', () => {
    renderPreview({
      previewText: ['  addToCart(item: CartItem): void {', '    this.items.p'].join('\n'),
      filePath: 'src/domain/cart.ts',
    })

    expect(screen.getByText('Preview')).toBeInTheDocument()
    expect(screen.getByText('addToCart(item: CartItem): void {')).toBeInTheDocument()
    expect(screen.getAllByText('cart.ts').length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Hunk \d/)).toBeNull()
  })

  it('renders a completed hunk diff card plus the growing preview card', () => {
    const { container } = renderPreview({
      hunks: [HUNK_ONE],
      previewText: ['  applyDiscount(percent: number): void {', '    if (percent < 0'].join('\n'),
      filePath: 'src/domain/cart.ts',
    })

    // hunk 卡片：标签带 pos、文件名、diff 统计与内容
    expect(screen.getByText('Hunk 1 · 18#RQ')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    expect(container.textContent).toContain('const subtotal = this.items')
    expect(container.textContent).toContain('return roundCents(subtotal')

    // 增长文本卡片
    expect(screen.getByText('Preview')).toBeInTheDocument()
    expect(container.textContent).toContain('applyDiscount(percent: number): void {')
  })

  it('renders one card per hunk in order', () => {
    renderPreview({ hunks: [HUNK_ONE, HUNK_TWO, HUNK_THREE] })

    const labels = screen.getAllByText(/^Hunk \d/).map(node => node.textContent)
    expect(labels).toEqual(['Hunk 1 · 18#RQ', 'Hunk 2 · 42#VX', 'Hunk 3 · 7#KP'])
    expect(screen.getByText('Hunk 1 · 18#RQ').compareDocumentPosition(screen.getByText('Hunk 3 · 7#KP'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    // 无增长文本时不渲染 Preview 卡片
    expect(screen.queryByText('Preview')).toBeNull()
  })

  it('renders nothing when there are neither hunks nor preview text', () => {
    const { container } = renderPreview({})

    expect(container.textContent).toBe('')
    expect(screen.queryByText('Preview')).toBeNull()
    expect(screen.queryByText(/^Hunk \d/)).toBeNull()
  })

  it('shows the blinking caret while preview text is streaming', () => {
    renderPreview({
      previewText: 'const a = 1\nconst b = 2',
      filePath: 'src/domain/cart.ts',
      language: 'typescript',
    })

    expect(screen.getByText('▍')).toBeInTheDocument()
  })
})

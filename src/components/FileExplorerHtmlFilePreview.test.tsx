import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HtmlFilePreview } from './FileExplorerHtmlFilePreview'

vi.mock('./CodePreview', () => ({
  CodePreview: ({ code, language }: { code: string; language: string }) => (
    <div data-testid="code-preview" data-language={language}>
      {code}
    </div>
  ),
}))

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}))

describe('HtmlFilePreview', () => {
  it('renders a sandboxed iframe with the file content by default', () => {
    render(<HtmlFilePreview text={'<h1>Hello</h1>'} />)

    const frame = screen.getByTitle('HTML preview')
    expect(frame).toBeInTheDocument()
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Hello</h1>')
    expect((frame as HTMLIFrameElement).style.colorScheme).toBe('dark')
    expect(screen.queryByTestId('code-preview')).not.toBeInTheDocument()
  })

  it('starts in code mode when a target line is provided', () => {
    render(<HtmlFilePreview text={'<h1>Hello</h1>'} targetLine={3} />)

    expect(screen.getByTestId('code-preview')).toHaveAttribute('data-language', 'html')
    expect(screen.getByTestId('code-preview')).toHaveTextContent('<h1>Hello</h1>')
    expect(screen.queryByTitle('HTML preview')).not.toBeInTheDocument()
  })

  it('toggles between preview and code through the i18n buttons', () => {
    render(<HtmlFilePreview text={'<p>Body</p>'} />)

    fireEvent.click(screen.getByRole('button', { name: 'Code' }))
    expect(screen.getByTestId('code-preview')).toHaveAttribute('data-language', 'html')
    expect(screen.getByTestId('code-preview')).toHaveTextContent('<p>Body</p>')
    expect(screen.queryByTitle('HTML preview')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByTitle('HTML preview')).toBeInTheDocument()
    expect(screen.queryByTestId('code-preview')).not.toBeInTheDocument()
  })

  it('survives empty and malformed html content', () => {
    render(<HtmlFilePreview text={'<div><span>broken'} />)
    expect(screen.getByTitle('HTML preview')).toBeInTheDocument()

    render(<HtmlFilePreview text="" />)
    expect(screen.getAllByTitle('HTML preview')).toHaveLength(2)
  })
})
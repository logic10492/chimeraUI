import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BinaryPlaceholder } from './FileExplorerBinaryPlaceholder'
import { MarkdownFilePreview } from './FileExplorerMarkdownFilePreview'
import { TextMediaPreview } from './FileExplorerTextMediaPreview'

vi.mock('./CodePreview', () => ({
  CodePreview: ({ code, language }: { code: string; language: string }) => (
    <div data-testid="code-preview" data-language={language}>
      {code}
    </div>
  ),
}))

vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown-renderer">{content}</div>,
}))

describe('FileExplorerParts', () => {
  describe('TextMediaPreview', () => {
    it('toggles between rendered preview and code', () => {
      render(
        <TextMediaPreview
          dataUrl="data:image/svg+xml;base64,PHN2Zy8+"
          text="<svg />"
          language="xml"
          fileName="diagram.svg"
        />,
      )

      expect(screen.getByRole('img', { name: 'diagram.svg' })).toBeInTheDocument()
      expect(screen.queryByTestId('code-preview')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Code' }))

      expect(screen.getByTestId('code-preview')).toHaveAttribute('data-language', 'xml')
      expect(screen.getByTestId('code-preview')).toHaveTextContent('<svg />')
      expect(screen.queryByRole('img', { name: 'diagram.svg' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

      expect(screen.getByRole('img', { name: 'diagram.svg' })).toBeInTheDocument()
      expect(screen.queryByTestId('code-preview')).not.toBeInTheDocument()
    })

    it('starts in code mode when a target line is provided', () => {
      render(
        <TextMediaPreview
          dataUrl="data:image/svg+xml;base64,PHN2Zy8+"
          text="<svg />"
          language="xml"
          fileName="diagram.svg"
          targetLine={3}
        />,
      )

      expect(screen.getByTestId('code-preview')).toHaveTextContent('<svg />')
    })
  })

  describe('MarkdownFilePreview', () => {
    it('toggles between rendered markdown and code', () => {
      render(<MarkdownFilePreview text={'# Title'} />)

      expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('# Title')
      expect(screen.queryByTestId('code-preview')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Code' }))

      expect(screen.getByTestId('code-preview')).toHaveAttribute('data-language', 'markdown')
      expect(screen.getByTestId('code-preview')).toHaveTextContent('# Title')
      expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument()
    })
  })

  describe('BinaryPlaceholder', () => {
    it('invokes onDownload from the download button', () => {
      const onDownload = vi.fn()
      render(<BinaryPlaceholder mimeType="application/octet-stream" fileName="archive.bin" onDownload={onDownload} />)

      expect(screen.getByText('archive.bin')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Download' }))

      expect(onDownload).toHaveBeenCalledTimes(1)
    })

    it('omits the download button without a handler', () => {
      render(<BinaryPlaceholder mimeType="application/octet-stream" fileName="archive.bin" />)

      expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument()
    })
  })
})
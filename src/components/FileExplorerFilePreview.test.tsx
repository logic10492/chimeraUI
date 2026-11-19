import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FilePreview } from './FileExplorerFilePreview'
import type { FileContent } from '../api/types'

const { capturedLayers } = vi.hoisted(() => ({ capturedLayers: [] as Array<{ content: unknown }> }))

vi.mock('./PreviewTabsBar', () => ({
  PreviewTabsBar: () => <div data-testid="preview-tabs-bar" />,
}))

vi.mock('../contexts/useFullscreen', () => ({
  useFullscreenLayer: (layer: { content: unknown } | null) => {
    if (layer) capturedLayers.push(layer)
    return { open: () => {} }
  },
}))

vi.mock('./CodePreview', () => ({
  CodePreview: ({ code, language }: { code: string; language: string }) => (
    <div data-testid="code-preview" data-language={language}>
      {code}
    </div>
  ),
}))

vi.mock('./FileExplorerHtmlFilePreview', () => ({
  HtmlFilePreview: ({ text }: { text: string }) => <div data-testid="html-file-preview">{text}</div>,
}))

const fileContent = (content: string, mimeType?: string) =>
  ({ content, mimeType, encoding: 'utf8' }) as unknown as FileContent

function renderPreview(path: string, content: FileContent, targetLine?: number) {
  return render(
    <FilePreview
      previewFiles={[{ path, name: path.split('/').pop() ?? path } as never]}
      path={path}
      targetLine={targetLine}
      content={content}
      isLoading={false}
      error={null}
      onClose={() => {}}
      onActivatePreview={() => {}}
      onClosePreview={() => {}}
      onReorderPreview={() => {}}
    />,
  )
}

describe('FilePreview html branch', () => {
  it('renders the html preview component for .html files without a mime type', () => {
    renderPreview('/project/index.html', fileContent('<h1>Hello</h1>'))

    expect(screen.getByTestId('html-file-preview')).toHaveTextContent('<h1>Hello</h1>')
    expect(screen.queryByTestId('code-preview')).not.toBeInTheDocument()
  })

  it('renders the html preview component for text/html mime types', () => {
    renderPreview('/project/template', fileContent('<p>Body</p>', 'text/html'))

    expect(screen.getByTestId('html-file-preview')).toHaveTextContent('<p>Body</p>')
  })

  it('renders the html preview component inside the fullscreen layer', () => {
    capturedLayers.length = 0
    renderPreview('/project/index.html', fileContent('<h1>Hello</h1>'))

    const layer = capturedLayers.at(-1)
    expect(layer).toBeDefined()
    render(<div>{layer!.content as ReactNode}</div>)

    expect(screen.getAllByTestId('html-file-preview').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps plain text files on the code preview path', () => {
    renderPreview('/project/notes.txt', fileContent('plain text'))

    expect(screen.getByTestId('code-preview')).toHaveTextContent('plain text')
    expect(screen.queryByTestId('html-file-preview')).not.toBeInTheDocument()
  })

  it('decodes base64 html content before preview', () => {
    const encoded = Buffer.from('<h1>Hello</h1>').toString('base64')
    renderPreview('/project/index.html', { content: encoded, encoding: 'base64' } as unknown as FileContent)

    expect(screen.getByTestId('html-file-preview')).toHaveTextContent('<h1>Hello</h1>')
  })
})
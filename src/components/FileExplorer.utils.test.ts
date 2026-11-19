import { describe, expect, it } from 'vitest'
import { isHtmlPreview, isMarkdownPreview } from './FileExplorer.utils'

describe('isHtmlPreview', () => {
  it('classifies html/htm languages without a mime type', () => {
    expect(isHtmlPreview('html')).toBe(true)
    expect(isHtmlPreview('htm')).toBe(true)
    expect(isHtmlPreview('HTML')).toBe(true)
    expect(isHtmlPreview('HTM')).toBe(true)
  })

  it('classifies text/html mime types, including parameters and casing', () => {
    expect(isHtmlPreview('text', 'text/html')).toBe(true)
    expect(isHtmlPreview('text', 'text/html; charset=utf-8')).toBe(true)
    expect(isHtmlPreview('text', 'TEXT/HTML')).toBe(true)
  })

  it('does not classify non-html languages or mime types', () => {
    expect(isHtmlPreview('text')).toBe(false)
    expect(isHtmlPreview('markdown', 'text/markdown')).toBe(false)
    expect(isHtmlPreview('xml', 'image/svg+xml')).toBe(false)
    expect(isHtmlPreview('typescript', 'text/plain')).toBe(false)
  })

  it('leaves markdown classification unaffected', () => {
    expect(isMarkdownPreview('markdown')).toBe(true)
    expect(isMarkdownPreview('mdx')).toBe(true)
    expect(isMarkdownPreview('text', 'text/x-markdown')).toBe(true)
    expect(isMarkdownPreview('html')).toBe(false)
  })
})
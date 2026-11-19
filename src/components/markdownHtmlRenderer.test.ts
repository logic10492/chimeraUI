import { describe, expect, it } from 'vitest'
import { renderMarkdownToHtml } from './markdownHtmlRenderer'

const LOCAL_FILE_HREF = '#opencode-local-file:'

function render(src: string) {
  const container = document.createElement('div')
  container.innerHTML = renderMarkdownToHtml(src, false)
  return container
}

function localFileLinks(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>(`a[href^="${LOCAL_FILE_HREF}"]`))
}

describe('markdownHtmlRenderer local file paths', () => {
  it('P1 links POSIX absolute paths in plain text', () => {
    const links = localFileLinks(render('see /a/b.ext here'))
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveTextContent('/a/b.ext')
    expect(links[0].getAttribute('href')).toBe(`${LOCAL_FILE_HREF}${encodeURIComponent('/a/b.ext')}`)
  })

  it('P2 links Windows absolute paths in both separator styles', () => {
    expect(localFileLinks(render('see C:\\a\\b.ext here'))).toHaveLength(1)
    expect(localFileLinks(render('see C:/a/b.ext here'))).toHaveLength(1)
  })

  it('P3 links relative paths with separators', () => {
    expect(localFileLinks(render('see src/foo.ts here'))).toHaveLength(1)
    expect(localFileLinks(render('see ./src/foo.ts here'))).toHaveLength(1)
    expect(localFileLinks(render('see ../foo.ts here'))).toHaveLength(1)
  })

  it('P4 links a bare filename inside codespan', () => {
    const links = localFileLinks(render('open `report.html` now'))
    expect(links).toHaveLength(1)
    expect(links[0].querySelector('code')).toHaveTextContent('report.html')
  })

  it('P5 keeps the :line suffix in the clickable href', () => {
    const links = localFileLinks(render('see src/foo.ts:12 here'))
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe(`${LOCAL_FILE_HREF}${encodeURIComponent('src/foo.ts:12')}`)
  })

  it('N1 does not linkify scheme URLs', () => {
    expect(localFileLinks(render('see https://example.com/foo.html here'))).toHaveLength(0)
    expect(localFileLinks(render('mailto:user@example.com'))).toHaveLength(0)
  })

  it('N2 does not linkify domain-like first segments', () => {
    expect(localFileLinks(render('see example.com/foo.html here'))).toHaveLength(0)
  })

  it('N2 does not linkify tails of scheme-less domain URLs', () => {
    expect(localFileLinks(render('see github.com/foo/bar.ts here'))).toHaveLength(0)
  })

  it('N3 does not linkify tokens whose first segment contains @', () => {
    expect(localFileLinks(render('see @scope/pkg/index.ts here'))).toHaveLength(0)
  })

  it('N4 does not linkify separator-free bare text', () => {
    expect(localFileLinks(render('and/or input/output v1.2.3'))).toHaveLength(0)
  })

  it('N5 does not linkify extensions that start with a digit', () => {
    expect(localFileLinks(render('see src/file.3 here'))).toHaveLength(0)
  })

  it('N8 excludes trailing punctuation from the link', () => {
    const links = localFileLinks(render('see src/foo.ts.'))
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveTextContent('src/foo.ts')
    expect(links[0].textContent).toBe('src/foo.ts')
  })

  it('N7 never nests anchors inside a markdown link label', () => {
    const container = render('[see src/foo.ts](https://example.com)')
    expect(localFileLinks(container)).toHaveLength(0)
    expect(container.textContent).toContain('see src/foo.ts')
  })

  it('N7 never nests anchors for codespan inside a link label', () => {
    expect(localFileLinks(render('[`src/foo.ts`](https://example.com)'))).toHaveLength(0)
  })

  it('N6 leaves fenced code blocks untouched', () => {
    expect(localFileLinks(render('```\nsrc/foo.ts\n```'))).toHaveLength(0)
  })

  it('N6 leaves inline math untouched', () => {
    expect(localFileLinks(render('$src/foo.ts$'))).toHaveLength(0)
  })

  it('N6 keeps existing text extensions working', () => {
    const container = render('==mark== and ^sup^ and ~sub~')
    expect(container.querySelector('mark')).not.toBeNull()
    expect(container.querySelector('sup')).not.toBeNull()
    expect(container.querySelector('sub')).not.toBeNull()
  })

  it('expands explicit markdown link hrefs to local file links', () => {
    const links = localFileLinks(render('[file](src/foo.ts)'))
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe(`${LOCAL_FILE_HREF}${encodeURIComponent('src/foo.ts')}`)
  })

  it('expands explicit bare-filename link hrefs', () => {
    const links = localFileLinks(render('[file](report.html)'))
    expect(links).toHaveLength(1)
  })

  it('expands raw HTML anchor hrefs to local file links', () => {
    const links = localFileLinks(render('<a href="src/foo.ts">file</a>'))
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe(`${LOCAL_FILE_HREF}${encodeURIComponent('src/foo.ts')}`)
  })

  it('keeps anchor and mailto links external', () => {
    const container = render('[jump](#section) [mail](mailto:user@example.com)')
    expect(localFileLinks(container)).toHaveLength(0)
  })
})
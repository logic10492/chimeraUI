import { describe, expect, it } from 'vitest'
import { matchLocalFilePathAt, parseLocalFilePath } from './localFilePath'

function matchAt(text: string, index = 0) {
  return matchLocalFilePathAt(text, index)
}

describe('local file path detection', () => {
  describe('positive shapes', () => {
    it('P1 detects POSIX absolute paths', () => {
      expect(matchAt('/a/b.ext')).toMatchObject({ path: '/a/b.ext', raw: '/a/b.ext' })
    })

    it('P2 detects Windows absolute paths in both separator styles', () => {
      expect(matchAt('C:\\a\\b.ext')).toMatchObject({ path: 'C:\\a\\b.ext' })
      expect(matchAt('C:/a/b.ext')).toMatchObject({ path: 'C:/a/b.ext' })
    })

    it('P3 detects relative paths with separators', () => {
      for (const value of ['a/b.ext', './a/b.ext', '../a.ext', 'a\\b.ext']) {
        expect(matchAt(value), value).toMatchObject({ path: value })
      }
    })

    it('P4 links a bare filename only in codespan context', () => {
      expect(parseLocalFilePath('report.html', { allowBareFilename: true })).toMatchObject({ path: 'report.html' })
      expect(matchAt('report.html')).toBeNull()
    })

    it('P5 parses :line and :line:column suffixes', () => {
      expect(matchAt('src/a.ts:123')).toMatchObject({ path: 'src/a.ts', targetLine: 123 })
      expect(matchAt('src/a.ts:123:45')).toMatchObject({ path: 'src/a.ts', targetLine: 123 })
    })
  })

  describe('negative shapes', () => {
    it('N1 skips scheme URLs', () => {
      for (const value of [
        'https://example.com/foo.html',
        'http://example.com/foo.html',
        'ftp://example.com/foo.html',
        'mailto:user@example.com',
      ]) {
        expect(matchAt(value), value).toBeNull()
      }
    })

    it('N2 skips domain-like first segments with an optional port', () => {
      expect(matchAt('example.com/foo.html')).toBeNull()
      expect(matchAt('example.io:8080/foo.ts')).toBeNull()
    })

    it('N2 rejects every cursor position inside a domain-like token', () => {
      const text = 'github.com/foo/bar.ts'
      for (let i = 0; i < text.length; i++) {
        expect(matchLocalFilePathAt(text, i), `index ${i}`).toBeNull()
      }
    })

    it('N1 rejects every cursor position inside a scheme URL token', () => {
      const text = 'https://example.com/foo.html'
      for (let i = 0; i < text.length; i++) {
        expect(matchLocalFilePathAt(text, i), `index ${i}`).toBeNull()
      }
    })

    it('N3 skips tokens whose first segment contains @', () => {
      expect(matchAt('user@example.com/foo.ts')).toBeNull()
      expect(matchAt('@scope/pkg/index.ts')).toBeNull()
    })

    it('N4 skips bare tokens without separators or a valid extension', () => {
      for (const value of ['and/or', 'input/output', '1.2.3', 'v1.2.3']) {
        expect(matchAt(value), value).toBeNull()
      }
    })

    it('N5 rejects extensions that do not start with a letter', () => {
      expect(parseLocalFilePath('file.3', { allowBareFilename: true })).toBeNull()
      expect(matchAt('src/file.3')).toBeNull()
    })

    it('does not start matching in the middle of a word', () => {
      expect(matchAt('xsrc/foo.ts', 1)).toBeNull()
    })
  })

  describe('boundaries', () => {
    it('N8 excludes trailing punctuation and leading brackets', () => {
      const sentence = 'see src/foo.ts.'
      const match = matchLocalFilePathAt(sentence, sentence.indexOf('src'))
      expect(match).toMatchObject({ raw: 'src/foo.ts', end: sentence.indexOf('src') + 'src/foo.ts'.length })

      const wrapped = '(src/foo.ts)'
      expect(matchLocalFilePathAt(wrapped, 0)).toBeNull()
      expect(matchLocalFilePathAt(wrapped, 1)).toMatchObject({ raw: 'src/foo.ts' })
    })

    it('N8 parses the line suffix before stripping punctuation', () => {
      expect(matchAt('src/foo.ts:12,')).toMatchObject({ path: 'src/foo.ts', targetLine: 12, raw: 'src/foo.ts:12' })
      expect(matchAt('src/foo.ts:')).toMatchObject({ path: 'src/foo.ts', raw: 'src/foo.ts' })
    })

    it('N10 stays linear on a long pathological token', () => {
      const start = performance.now()
      expect(matchAt('a/'.repeat(20000))).toBeNull()
      expect(performance.now() - start).toBeLessThan(500)
    })
  })
})
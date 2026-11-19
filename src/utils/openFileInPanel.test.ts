import { beforeEach, describe, expect, it, vi } from 'vitest'

const openFilePreviewMock = vi.hoisted(() => vi.fn())

vi.mock('../store/layoutStore', () => ({
  layoutStore: { openFilePreview: openFilePreviewMock },
}))

const { openFileInPanel } = await import('./openFileInPanel')

describe('openFileInPanel', () => {
  beforeEach(() => {
    openFilePreviewMock.mockClear()
  })

  it('C2 opens a relative path directly in the right panel', () => {
    expect(openFileInPanel('src/foo.ts')).toBe(true)
    expect(openFilePreviewMock).toHaveBeenCalledWith({ path: 'src/foo.ts', name: 'foo.ts' }, 'right')
  })

  it('C2 strips a leading ./ and normalizes backslashes', () => {
    expect(openFileInPanel('.\\src\\foo.ts')).toBe(true)
    expect(openFilePreviewMock).toHaveBeenCalledWith({ path: 'src/foo.ts', name: 'foo.ts' }, 'right')
  })

  it('C2 parses a :line suffix into targetLine', () => {
    expect(openFileInPanel('src/foo.ts:42')).toBe(true)
    expect(openFilePreviewMock).toHaveBeenCalledWith({ path: 'src/foo.ts', name: 'foo.ts', targetLine: 42 }, 'right')
  })

  it('C2 relativizes an absolute path inside directory', () => {
    expect(openFileInPanel('/repo/src/foo.ts', '/repo')).toBe(true)
    expect(openFilePreviewMock).toHaveBeenCalledWith({ path: 'src/foo.ts', name: 'foo.ts' }, 'right')
  })

  it('C2 relativizes a Windows absolute path inside a Windows directory', () => {
    expect(openFileInPanel('C:\\repo\\src\\foo.ts', 'C:\\repo')).toBe(true)
    expect(openFilePreviewMock).toHaveBeenCalledWith({ path: 'src/foo.ts', name: 'foo.ts' }, 'right')
  })

  it('C2 returns false for an absolute path outside directory', () => {
    expect(openFileInPanel('/other/src/foo.ts', '/repo')).toBe(false)
    expect(openFilePreviewMock).not.toHaveBeenCalled()
  })

  it('C2 returns false for an absolute path without directory context', () => {
    expect(openFileInPanel('/repo/src/foo.ts')).toBe(false)
    expect(openFilePreviewMock).not.toHaveBeenCalled()
  })

  it('C5 opens relative paths without directory context', () => {
    expect(openFileInPanel('../shared/foo.ts')).toBe(true)
    expect(openFilePreviewMock).toHaveBeenCalledWith({ path: '../shared/foo.ts', name: 'foo.ts' }, 'right')
  })

  it('C2 opens a bare filename as a relative path (codespan/href parity)', () => {
    expect(openFileInPanel('report.html')).toBe(true)
    expect(openFilePreviewMock).toHaveBeenCalledWith({ path: 'report.html', name: 'report.html' }, 'right')
  })

  it('returns false for non-path values', () => {
    expect(openFileInPanel('not-a-path')).toBe(false)
    expect(openFileInPanel('https://example.com/foo.ts')).toBe(false)
    expect(openFilePreviewMock).not.toHaveBeenCalled()
  })
})
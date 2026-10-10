import { describe, expect, it } from 'vitest'
import { extractContentFromUnifiedDiff, splitUnifiedDiffHunks } from './diffUtils'

const HEADER = 'Index: src/a.ts\n===\n--- src/a.ts\n+++ src/a.ts'
const HUNK1 = '@@ -1,2 +1,2 @@\n context\n-old\n+new'
const HUNK2 = '@@ -10,2 +10,3 @@\n other\n-removed\n+added\n+more'

describe('splitUnifiedDiffHunks', () => {
  it('returns the original diff as a single piece when there is exactly one hunk', () => {
    const diff = `${HEADER}\n${HUNK1}\n`
    const pieces = splitUnifiedDiffHunks(diff)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toBe(diff)
  })

  it('splits on @@ headers, keeping the header with each hunk and file headers with the first piece', () => {
    const diff = `${HEADER}\n${HUNK1}\n${HUNK2}\n`
    const pieces = splitUnifiedDiffHunks(diff)
    expect(pieces).toHaveLength(2)
    expect(pieces[0].startsWith('Index: src/a.ts')).toBe(true)
    expect(pieces[0].startsWith('@@')).toBe(false)
    expect(pieces[1].startsWith('@@ -10,2 +10,3 @@')).toBe(true)
    expect(pieces.join('\n')).toBe(diff)
  })

  it('handles hunks without a file header', () => {
    const pieces = splitUnifiedDiffHunks(`${HUNK1}\n${HUNK2}`)
    expect(pieces).toHaveLength(2)
    expect(pieces[0].startsWith('@@ -1,2 +1,2 @@')).toBe(true)
  })

  it('returns the whole text as one piece when no @@ header exists', () => {
    expect(splitUnifiedDiffHunks('just some text')).toEqual(['just some text'])
  })

  it('returns nothing for empty input', () => {
    expect(splitUnifiedDiffHunks('')).toEqual([])
  })

  it('each piece still parses through extractContentFromUnifiedDiff', () => {
    const diff = `${HEADER}\n${HUNK1}\n${HUNK2}\n`
    for (const piece of splitUnifiedDiffHunks(diff)) {
      const { before, after } = extractContentFromUnifiedDiff(piece)
      expect(before).toBeTruthy()
      expect(after).toBeTruthy()
    }
  })
})

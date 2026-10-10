import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../../../utils/languageUtils'
import {
  extractStreamingEdits,
  extractStreamingString,
  firstPatchFilePath,
  isEditLikeTool,
} from './streamingInput'

const EDIT_RAW =
  '{"filePath":"src/app.ts","description":"demo edit","edits":[{"op":"replace","pos":"17#K2","lines":["const a = 1","const b = 2"]},{"op":"append","end":"41#Z9","lines":["tail line 1","tail "]}'

const WRITE_RAW = '{"filePath":"src/b.ts","content":"line1\\nline2\\t\\"quoted\\" \\\\ / \\u0041end"}'

describe('extractStreamingString', () => {
  it('never throws for any truncation offset of the edit payload', () => {
    for (let cut = 0; cut <= EDIT_RAW.length; cut++) {
      expect(() => extractStreamingString(EDIT_RAW.slice(0, cut), 'filePath')).not.toThrow()
      expect(() => extractStreamingString(EDIT_RAW.slice(0, cut), 'description')).not.toThrow()
      expect(() => extractStreamingString(EDIT_RAW.slice(0, cut), 'content')).not.toThrow()
    }
  })

  it('never throws for any truncation offset of the write payload', () => {
    for (let cut = 0; cut <= WRITE_RAW.length; cut++) {
      expect(() => extractStreamingString(WRITE_RAW.slice(0, cut), 'filePath')).not.toThrow()
      expect(() => extractStreamingString(WRITE_RAW.slice(0, cut), 'content')).not.toThrow()
    }
  })

  it('decodes escape sequences including \\n \\t \\" \\\\ \\/ \\uXXXX', () => {
    expect(extractStreamingString(WRITE_RAW, 'content')).toBe('line1\nline2\t"quoted" \\ / Aend')
  })

  it('returns decoded-so-far for an unterminated string', () => {
    expect(extractStreamingString('{"content":"abc', 'content')).toBe('abc')
    expect(extractStreamingString('{"content":"abc\\', 'content')).toBe('abc')
    expect(extractStreamingString('{"content":"abc\\u00', 'content')).toBe('abc')
    expect(extractStreamingString('{"content":"li\\nne', 'content')).toBe('li\nne')
  })

  it('returns undefined before the value starts, for non-strings, or for missing keys', () => {
    expect(extractStreamingString('{"content":', 'content')).toBeUndefined()
    expect(extractStreamingString('{"content": 12', 'content')).toBeUndefined()
    expect(extractStreamingString('{"filePath":"a.ts"}', 'content')).toBeUndefined()
    expect(extractStreamingString('', 'content')).toBeUndefined()
    expect(extractStreamingString('not json', 'content')).toBeUndefined()
  })

  it('skips earlier members even when they contain escaped quotes', () => {
    const raw = '{"filePath":"a\\"b","content":"x"}'
    expect(extractStreamingString(raw, 'filePath')).toBe('a"b')
    expect(extractStreamingString(raw, 'content')).toBe('x')
  })
})

describe('extractStreamingEdits', () => {
  it('never throws for any truncation offset', () => {
    for (let cut = 0; cut <= EDIT_RAW.length; cut++) {
      expect(() => extractStreamingEdits(EDIT_RAW.slice(0, cut))).not.toThrow()
    }
    expect(() => extractStreamingEdits('{"edits":[{"lines":["\\')).not.toThrow()
    expect(() => extractStreamingEdits('}}}[')).not.toThrow()
  })

  it('extracts filePath and per-op previews from the complete payload', () => {
    const raw = EDIT_RAW + ']}'
    const parsed = extractStreamingEdits(raw)
    expect(parsed.filePath).toBe('src/app.ts')
    expect(parsed.ops).toHaveLength(2)
    expect(parsed.ops[0]).toEqual({
      op: 'replace',
      pos: '17#K2',
      end: undefined,
      linesText: 'const a = 1\nconst b = 2',
      complete: true,
    })
    expect(parsed.ops[1].op).toBe('append')
    expect(parsed.ops[1].end).toBe('41#Z9')
    expect(parsed.ops[1].linesText).toBe('tail line 1\ntail ')
    expect(parsed.ops[1].complete).toBe(true)
  })

  it('joins completed lines plus the currently-growing last line and marks the op incomplete', () => {
    const cut = EDIT_RAW.lastIndexOf('tail ') + 'tail '.length - 3
    const parsed = extractStreamingEdits(EDIT_RAW.slice(0, cut))
    expect(parsed.ops[1].linesText).toBe('tail line 1\nta')
    expect(parsed.ops[1].complete).toBe(false)
    expect(parsed.ops[0].complete).toBe(true)
  })

  it('treats an op as incomplete until both its lines value and object are closed', () => {
    const objClosed = '{"filePath":"f","edits":[{"op":"append","lines":["a"]}'
    expect(extractStreamingEdits(objClosed).ops[0].complete).toBe(true)
    const linesOpen = '{"filePath":"f","edits":[{"op":"append","lines":["a"'
    expect(extractStreamingEdits(linesOpen).ops[0].complete).toBe(false)
    expect(extractStreamingEdits(linesOpen).ops[0].linesText).toBe('a')
  })

  it('supports lines as a plain string value', () => {
    const parsed = extractStreamingEdits('{"filePath":"f","edits":[{"op":"replace","lines":"a\\nb"}]}')
    expect(parsed.ops[0].linesText).toBe('a\nb')
    expect(parsed.ops[0].complete).toBe(true)
  })

  it('returns empty ops for garbage or missing edits', () => {
    expect(extractStreamingEdits('').ops).toEqual([])
    expect(extractStreamingEdits('{"filePath":"a.ts"}').ops).toEqual([])
    expect(extractStreamingEdits('{"filePath":"a.ts"}').filePath).toBe('a.ts')
  })
})

describe('firstPatchFilePath', () => {
  it('finds the first file header in growing apply_patch text', () => {
    expect(firstPatchFilePath('*** Begin Patch\n*** Update File: src/a.ts\n@@ -1 +1 @@')).toBe('src/a.ts')
    expect(firstPatchFilePath('*** Begin Patch\n*** Add File: ne')).toBe('ne')
    expect(firstPatchFilePath('*** Begin Patch\n')).toBeUndefined()
  })
})

describe('isEditLikeTool', () => {
  it('matches the registry edit matcher', () => {
    for (const name of ['edit', 'Edit', 'edit_file', 'replace_in_file', 'apply_patch', 'chimera_patch']) {
      expect(isEditLikeTool(name)).toBe(true)
    }
    for (const name of ['write', 'bash', 'read', 'task', 'grep']) {
      expect(isEditLikeTool(name)).toBe(false)
    }
  })
})

describe('detectLanguage integration shape', () => {
  it('resolves a language for streaming preview paths', () => {
    expect(detectLanguage('src/app.ts')).toBeTruthy()
  })
})

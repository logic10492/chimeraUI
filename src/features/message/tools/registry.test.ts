import { describe, expect, it } from 'vitest'
import type { ToolPart } from '../../../types/message'
import { defaultExtractData, extractToolData } from './registry'
import { detectLanguage } from '../../../utils/languageUtils'

describe('defaultExtractData', () => {
  it('extracts files and diagnostics from metadata', () => {
    const part = {
      type: 'tool',
      tool: 'read',
      id: 'tool-1',
      callID: 'call-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      state: {
        input: { filePath: 'src/app.ts' },
        metadata: {
          files: [
            {
              filePath: 'src/app.ts',
              diff: '@@ -1 +1 @@',
              additions: 1,
              deletions: 1,
            },
          ],
          diagnostics: {
            'src/app.ts': [
              {
                severity: 1,
                message: 'Syntax error',
                range: { start: { line: 3, character: 5 } },
              },
            ],
          },
        },
      },
    } as unknown as ToolPart

    const extracted = defaultExtractData(part)

    expect(extracted.files).toEqual([expect.objectContaining({ filePath: 'src/app.ts', additions: 1, deletions: 1 })])
    expect(extracted.diagnostics).toEqual([
      expect.objectContaining({ file: 'app.ts', severity: 'error', line: 3, column: 5 }),
    ])
  })
})

function makeToolPart(state: Record<string, unknown>, tool: string): ToolPart {
  return {
    type: 'tool',
    tool,
    id: 'tool-1',
    callID: 'call-1',
    sessionID: 'session-1',
    messageID: 'message-1',
    state,
  } as unknown as ToolPart
}

describe('streaming preview extraction', () => {
  it('write: exposes growing content while pending', () => {
    const part = makeToolPart({ status: 'pending', input: {}, raw: '{"filePath":"src/a.ts","content":"hello wo' }, 'write')
    const data = extractToolData(part)
    expect(data.streamingPreview).toEqual({
      filePath: 'src/a.ts',
      text: 'hello wo',
      language: detectLanguage('src/a.ts'),
    })
  })

  it('bash: partial command grows base.input while running', () => {
    const part = makeToolPart({ status: 'running', input: {}, raw: '{"command":"ls -la', time: { start: 1 } }, 'bash')
    const data = extractToolData(part)
    expect(data.input).toBe('ls -la')
    expect(data.inputLang).toBe('bash')
    expect(data.streamingPreview).toEqual({ text: 'ls -la', language: 'bash' })
  })

  it('edit: previews the first incomplete op lines while pending', () => {
    const raw =
      '{"filePath":"src/app.ts","edits":[{"op":"append","lines":["x","y"]},{"op":"replace","pos":"3#AB","lines":["gr'
    const part = makeToolPart({ status: 'pending', input: {}, raw }, 'edit')
    const data = extractToolData(part)
    expect(data.streamingPreview).toEqual({
      filePath: 'src/app.ts',
      text: 'gr',
      language: detectLanguage('src/app.ts'),
    })
  })

  it('edit: falls back to the last completed op when all are closed', () => {
    const raw = '{"filePath":"src/app.ts","edits":[{"op":"append","lines":["x"]}]}'
    const part = makeToolPart({ status: 'running', input: {}, raw, time: { start: 1 } }, 'edit')
    const data = extractToolData(part)
    expect(data.streamingPreview?.text).toBe('x')
  })

  it('apply_patch: previews growing patch text with early file path', () => {
    const patchText = '*** Begin Patch\n*** Update File: src/a.ts\n@@ -1 +1 @@\n-a\n+b\n'
    const raw = JSON.stringify({ patchText })
    // 去掉收尾的 "} ：字符串未闭合，但已解码出全部内容
    const part = makeToolPart({ status: 'pending', input: {}, raw: raw.slice(0, raw.length - 2) }, 'apply_patch')
    const data = extractToolData(part)
    expect(data.streamingPreview).toEqual({
      filePath: 'src/a.ts',
      text: patchText,
      language: detectLanguage('src/a.ts'),
    })
  })

  it('ignores raw on completed parts and stays inert without raw', () => {
    const completed = makeToolPart(
      {
        status: 'completed',
        input: {},
        raw: '{"filePath":"src/a.ts","content":"hello"}',
        output: 'ok',
        title: 'Write',
        metadata: {},
        time: { start: 1, end: 2 },
      },
      'write',
    )
    expect(extractToolData(completed).streamingPreview).toBeUndefined()

    const noRaw = makeToolPart({ status: 'pending', input: {} }, 'write')
    expect(extractToolData(noRaw).streamingPreview).toBeUndefined()
  })
})

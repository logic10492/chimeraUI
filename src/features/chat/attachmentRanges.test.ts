import { describe, expect, it } from 'vitest'
import type { Attachment } from '../attachment'
import { removeAttachmentFromText, transformAttachmentRanges } from './attachmentRanges'

function mention(id: string, value: string, start: number): Attachment {
  return {
    id,
    type: 'file',
    displayName: value.slice(1),
    textRange: { value, start, end: start + value.length },
  }
}

describe('transformAttachmentRanges', () => {
  it('shifts a mention after text is inserted before it', () => {
    const attachments = [mention('file', '@file', 6)]

    expect(transformAttachmentRanges('hello @file', 'say hello @file', attachments)[0].textRange).toEqual({
      value: '@file',
      start: 10,
      end: 15,
    })
  })

  it('shifts a mention after text is deleted before it', () => {
    const attachments = [mention('file', '@file', 7)]

    expect(transformAttachmentRanges('prefix @file', 'pre @file', attachments)[0].textRange).toEqual({
      value: '@file',
      start: 4,
      end: 9,
    })
  })

  it.each([
    ['insertion', 'hello @file', 'hello @fiXle'],
    ['deletion', 'hello @file', 'hello @fie'],
  ])('removes a mention after an %s inside its range', (_name, previousText, nextText) => {
    expect(transformAttachmentRanges(previousText, nextText, [mention('file', '@file', 6)])).toEqual([])
  })

  it('preserves duplicate mention attachments when only unrelated text changes', () => {
    const attachments = [mention('first', '@file', 0), mention('second', '@file', 6)]

    const result = transformAttachmentRanges('@file @file', 'x @file @file', attachments)

    expect(result.map(attachment => attachment.textRange)).toEqual([
      { value: '@file', start: 2, end: 7 },
      { value: '@file', start: 8, end: 13 },
    ])
  })
})

describe('removeAttachmentFromText', () => {
  it('removes only the exact duplicate mention range and shifts later ranges', () => {
    const attachments = [mention('first', '@file', 0), mention('second', '@file', 6), mention('later', '@other', 12)]

    const result = removeAttachmentFromText('@file @file @other', attachments, 'second')

    expect(result.text).toBe('@file @other')
    expect(result.attachments.map(attachment => [attachment.id, attachment.textRange])).toEqual([
      ['first', { value: '@file', start: 0, end: 5 }],
      ['later', { value: '@other', start: 6, end: 12 }],
    ])
  })
})

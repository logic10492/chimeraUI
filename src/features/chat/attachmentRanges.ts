import type { Attachment } from '../attachment'

function getEditSpan(previousText: string, nextText: string) {
  const maxPrefix = Math.min(previousText.length, nextText.length)
  let start = 0
  while (start < maxPrefix && previousText[start] === nextText[start]) start += 1

  const maxSuffix = Math.min(previousText.length - start, nextText.length - start)
  let suffixLength = 0
  while (
    suffixLength < maxSuffix &&
    previousText[previousText.length - 1 - suffixLength] === nextText[nextText.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  return {
    start,
    previousEnd: previousText.length - suffixLength,
    nextEnd: nextText.length - suffixLength,
  }
}

export function transformAttachmentRanges(previousText: string, nextText: string, attachments: Attachment[]) {
  if (previousText === nextText) return attachments

  const edit = getEditSpan(previousText, nextText)
  const delta = edit.nextEnd - edit.previousEnd
  const transformed = attachments.flatMap(attachment => {
    const range = attachment.textRange
    if (!range || range.end <= edit.start) return [attachment]

    const textRange = {
      ...range,
      start: range.start + delta,
      end: range.end + delta,
    }
    return nextText.slice(textRange.start, textRange.end) === textRange.value ? [{ ...attachment, textRange }] : []
  })

  return transformed.length === attachments.length &&
    transformed.every((attachment, index) => attachment === attachments[index])
    ? attachments
    : transformed
}

export function removeAttachmentFromText(text: string, attachments: Attachment[], id: string) {
  const attachment = attachments.find(item => item.id === id)
  if (!attachment?.textRange) {
    return {
      text,
      attachments: attachments.filter(item => item.id !== id),
    }
  }

  const range = attachment.textRange
  const removalEnd = text[range.end] === ' ' ? range.end + 1 : range.end
  const nextText = text.slice(0, range.start) + text.slice(removalEnd)

  return {
    text: nextText,
    attachments: transformAttachmentRanges(
      text,
      nextText,
      attachments.filter(item => item.id !== id),
    ),
  }
}

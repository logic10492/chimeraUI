import { memo, useState } from 'react'
import type { FilePart } from '../../../types/message'
import type { Attachment } from '../../attachment/types'
import { AttachmentDetailModal } from '../../attachment/AttachmentDetailModal'

// ============================================
// ToolAttachments - 工具结果附件渲染
// 图片附件渲染缩略图（点击放大），非图片附件渲染文件芯片
// ============================================

function toAttachment(part: FilePart, index: number): Attachment {
  const isImage = part.mime?.startsWith('image/')
  return {
    id: part.id ?? `tool-attachment-${index}`,
    type: 'file',
    displayName: part.filename || (isImage ? 'image' : part.mime || 'attachment'),
    url: part.url,
    mime: part.mime,
  }
}

interface ToolAttachmentsProps {
  attachments?: FilePart[]
}

export const ToolAttachments = memo(function ToolAttachments({ attachments }: ToolAttachmentsProps) {
  const [openAttachment, setOpenAttachment] = useState<Attachment | null>(null)

  if (!attachments?.length) return null

  return (
    <div className="mt-2 flex flex-wrap items-start gap-2" data-testid="tool-attachments">
      {attachments.map((part, index) => (
        <ToolAttachmentItem key={part.id ?? index} part={part} index={index} onOpen={setOpenAttachment} />
      ))}
      <AttachmentDetailModal
        attachment={openAttachment}
        isOpen={!!openAttachment}
        onClose={() => setOpenAttachment(null)}
      />
    </div>
  )
})

function ToolAttachmentItem({
  part,
  index,
  onOpen,
}: {
  part: FilePart
  index: number
  onOpen: (attachment: Attachment) => void
}) {
  const [imageError, setImageError] = useState(false)
  const isImage = !!part.mime?.startsWith('image/') && !!part.url && !imageError
  const attachment = toAttachment(part, index)

  if (isImage) {
    return (
      <button
        type="button"
        onClick={() => onOpen(attachment)}
        title={attachment.displayName}
        className="block max-w-[240px] overflow-hidden rounded-md border border-border-300/50 bg-bg-300 transition-colors hover:border-border-200"
      >
        <img
          src={part.url}
          alt={attachment.displayName}
          loading="lazy"
          decoding="async"
          onError={() => setImageError(true)}
          className="max-h-40 w-full object-contain"
        />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(attachment)}
      title={attachment.displayName}
      className="inline-flex max-w-[240px] items-center gap-1.5 rounded-md border border-border-300/50 bg-bg-300 px-2 py-1 text-[length:var(--fs-sm)] transition-colors hover:border-border-200"
    >
      <span className="truncate text-text-200">{part.filename || 'attachment'}</span>
      {part.mime && <span className="shrink-0 font-mono text-[length:var(--fs-xxs)] text-text-500">{part.mime}</span>}
    </button>
  )
}

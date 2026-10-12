// ============================================
// Binary Placeholder - 不可预览的二进制文件
// ============================================

import { useTranslation } from 'react-i18next'
import { DownloadIcon } from './Icons'
import { getMaterialIconUrl } from '../utils/materialIcons'
import { formatMimeType } from '../utils/mimeUtils'
import type { BinaryPlaceholderProps } from './FileExplorer.types'

export function BinaryPlaceholder({ mimeType, fileName, onDownload }: BinaryPlaceholderProps) {
  const { t } = useTranslation(['components', 'common'])

  return (
    <div className="flex flex-col items-center justify-center h-full text-text-400 text-[length:var(--fs-sm)] gap-2 p-4">
      <img
        src={getMaterialIconUrl(fileName, 'file')}
        alt=""
        width={32}
        height={32}
        className="opacity-50"
        onError={e => {
          e.currentTarget.style.visibility = 'hidden'
        }}
      />
      <span className="font-medium text-text-300">{fileName}</span>
      <span>{formatMimeType(mimeType)}</span>
      <span className="text-text-500 text-[length:var(--fs-xxs)]">{t('components:fileExplorer.binaryFile')}</span>
      {onDownload && (
        <button
          onClick={onDownload}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-bg-200 hover:bg-bg-300 text-text-200 rounded transition-colors text-[length:var(--fs-xs)]"
        >
          <DownloadIcon size={12} />
          {t('common:download')}
        </button>
      )}
    </div>
  )
}
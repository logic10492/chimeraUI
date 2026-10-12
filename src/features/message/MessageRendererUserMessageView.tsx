import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon, UndoIcon } from '../../components/Icons'
import { CopyButton } from '../../components/ui'
import { useDelayedRender } from '../../hooks/useDelayedRender'
import { useDisclosureScrollLock } from '../../hooks/useDisclosureScrollLock'
import { useTheme } from '../../hooks/useTheme'
import { useUiDisclosureState } from '../../utils/uiDisclosureState'
import type { TextPart, FilePart, AgentPart, CompactionPart } from '../../types/message'
import { FilePartView, AgentPartView, SyntheticTextPartView } from './parts/AttachmentPartViews'
import { CompactionPartView } from './parts/SystemPartViews'
import { useEntryGrowAnimation } from './MessageRenderer.hooks'
import { CollapsibleUserText } from './MessageRendererCollapsibleUserText'
import { ForkActionButton } from './MessageRendererForkActionButton'
import { USER_HTML_ARTIFACT_PATTERN } from './MessageRenderer.utils'
import type { UserMessageViewProps } from './MessageRenderer.types'

export const UserMessageView = memo(function UserMessageView({
  message,
  onUndo,
  onFork,
  forkMessageId,
  canUndo,
}: UserMessageViewProps) {
  const { t } = useTranslation('message')
  const { parts, info } = message
  const [showSystemContext, setShowSystemContext] = useUiDisclosureState(
    `message:${info.id}:user-system-context`,
    false,
  )
  const shouldRenderSystemContext = useDelayedRender(showSystemContext)
  const {
    rootRef: systemContextRootRef,
    headerRef: systemContextHeaderRef,
    withScrollLock: withSystemContextScrollLock,
  } = useDisclosureScrollLock()
  const { collapseUserMessages, renderUserMarkdown } = useTheme()

  const wrapperRef = useEntryGrowAnimation(info.time.created)

  // 分离不同类型的 parts
  const textParts = parts.filter((p): p is TextPart => p.type === 'text' && !p.synthetic)
  const syntheticParts = parts.filter((p): p is TextPart => p.type === 'text' && !!p.synthetic)
  const fileParts = parts.filter((p): p is FilePart => p.type === 'file')
  const agentParts = parts.filter((p): p is AgentPart => p.type === 'agent')
  const compactionParts = parts.filter((p): p is CompactionPart => p.type === 'compaction')

  const hasSystemContext = syntheticParts.length > 0
  const messageText = textParts.map(p => p.text).join('')
  const hasUserHtmlArtifact = renderUserMarkdown && USER_HTML_ARTIFACT_PATTERN.test(messageText)

  return (
    <div
      ref={wrapperRef}
      data-user-html-artifact={hasUserHtmlArtifact ? '' : undefined}
      className={`flex flex-col items-end group ${hasUserHtmlArtifact ? 'w-full' : ''}`}
    >
      <div className="flex flex-col gap-1 items-end w-full">
        {/* 消息文本 */}
        {messageText && (
          <CollapsibleUserText
            text={messageText}
            collapseEnabled={collapseUserMessages}
            renderMarkdown={renderUserMarkdown}
            messageId={info.id}
          />
        )}

        {/* 用户附件 */}
        {(fileParts.length > 0 || agentParts.length > 0) && (
          <div className="mt-1 flex max-w-full min-w-0 flex-wrap gap-2 justify-end">
            {fileParts.map(part => (
              <FilePartView key={part.id} part={part} />
            ))}
            {agentParts.map(part => (
              <AgentPartView key={part.id} part={part} />
            ))}
          </div>
        )}

        {/* 系统上下文 */}
        {hasSystemContext && (
          <div ref={systemContextRootRef} className="flex flex-col items-end mt-1 w-full">
            <button
              type="button"
              ref={systemContextHeaderRef}
              onClick={() => withSystemContextScrollLock(() => setShowSystemContext(!showSystemContext))}
              className="flex items-center gap-1 text-[length:var(--fs-sm)] text-text-400 hover:text-text-300 transition-colors py-1 px-2 rounded hover:bg-bg-200"
            >
              <span>
                {showSystemContext ? t('hideSystemContext') : t('showSystemContext', { count: syntheticParts.length })}
              </span>
              <span className={`transition-transform duration-300 ${showSystemContext ? '' : '-rotate-90'}`}>
                <ChevronDownIcon size={10} />
              </span>
            </button>

            <div
              className={`grid w-full transition-[grid-template-rows,opacity] duration-300 ease-out ${
                showSystemContext ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                {shouldRenderSystemContext && (
                  <div className="pt-2 flex max-w-full min-w-0 flex-wrap gap-2 justify-end">
                    {syntheticParts.map(part => (
                      <SyntheticTextPartView key={part.id} part={part} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {compactionParts.length > 0 && (
          <div className="w-full mt-1">
            {compactionParts.map(part => (
              <CompactionPartView key={part.id} part={part} />
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 [@media(any-pointer:coarse)]:opacity-100 transition-opacity">
          {/* Undo button */}
          {canUndo && onUndo && (
            <button
              onClick={() => onUndo(info.id)}
              className="p-1.5 rounded-md transition-colors duration-150 text-text-400 hover:text-text-200"
              title={t('undoFromHere')}
            >
              <UndoIcon />
            </button>
          )}
          <ForkActionButton message={message} onFork={onFork} forkMessageId={forkMessageId} />
          {/* Copy button */}
          {messageText && <CopyButton text={messageText} position="static" />}
        </div>
      </div>
    </div>
  )
})
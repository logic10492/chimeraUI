import { memo, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { useDisclosureScrollLock } from '../../hooks/useDisclosureScrollLock'
import { useUiDisclosureState } from '../../utils/uiDisclosureState'
import { COLLAPSE_PREVIEW_LINES, LEADING_RELAXED, USER_HTML_ARTIFACT_PATTERN } from './MessageRenderer.utils'

export interface CollapsibleUserTextProps {
  text: string
  collapseEnabled: boolean
  renderMarkdown: boolean
  messageId: string
}

// 折叠状态缓存：消息是否溢出
const overflowStateCache = new Map<string, boolean>()

export const CollapsibleUserText = memo(function CollapsibleUserText({
  text,
  collapseEnabled,
  renderMarkdown,
  messageId,
}: CollapsibleUserTextProps) {
  const { t } = useTranslation('message')
  const contentRef = useRef<HTMLDivElement>(null)
  const { rootRef, headerRef, withScrollLock } = useDisclosureScrollLock()
  const overflowCacheKey = `${messageId}:${renderMarkdown ? 'markdown' : 'plain'}`
  const [expanded, setExpanded] = useUiDisclosureState(`message:${messageId}:user-text`, false)
  const [isOverflow, setIsOverflow] = useState(() => overflowStateCache.get(overflowCacheKey) ?? false)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return

    let disposed = false
    const measure = () => {
      if (disposed) return
      const fsBase = Number.parseFloat(window.getComputedStyle(el).getPropertyValue('--fs-base'))
      if (!Number.isFinite(fsBase) || fsBase <= 0) return
      const collapsedHeight = fsBase * LEADING_RELAXED * COLLAPSE_PREVIEW_LINES
      const next = el.scrollHeight > collapsedHeight + 1
      overflowStateCache.set(overflowCacheKey, next)
      setIsOverflow(prev => (prev === next ? prev : next))
    }

    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(el)
    document.fonts?.ready?.then(measure)

    return () => {
      disposed = true
      resizeObserver.disconnect()
    }
  }, [text, overflowCacheKey])

  const hasHtmlArtifact = renderMarkdown && USER_HTML_ARTIFACT_PATTERN.test(text)
  const showCollapse = collapseEnabled && !hasHtmlArtifact && isOverflow
  const isCollapsed = collapseEnabled && !hasHtmlArtifact && !expanded

  return (
    <div ref={rootRef} className={`px-4 py-2.5 bg-bg-300 rounded-2xl max-w-full ${hasHtmlArtifact ? 'w-full max-w-2xl' : ''}`}>
      <div className="relative">
        <div
          ref={node => {
            contentRef.current = node
            headerRef(node)
          }}
          className={`m-0 break-words text-[length:var(--fs-base)] text-text-100 leading-relaxed${
            renderMarkdown ? '' : ' whitespace-pre-wrap'
          }${
            isCollapsed ? ' overflow-hidden' : ''
          }`}
          style={
            isCollapsed
              ? {
                  maxHeight: `calc(var(--fs-base) * ${LEADING_RELAXED} * ${COLLAPSE_PREVIEW_LINES})`,
                  contain: 'layout paint',
                }
              : undefined
          }
        >
          {renderMarkdown ? <MarkdownRenderer content={text} /> : text}
        </div>
        {/* 底部渐变遮罩 */}
        {showCollapse && isCollapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg-300 to-transparent pointer-events-none" />
        )}
      </div>
      {showCollapse && (
        <button
          type="button"
          onClick={() => withScrollLock(() => setExpanded(prev => !prev))}
          className="mt-1 text-[length:var(--fs-sm)] text-text-400 hover:text-text-200 transition-colors"
          aria-expanded={expanded}
        >
          {expanded ? t('showLess') : t('showMore')}
        </button>
      )}
    </div>
  )
})
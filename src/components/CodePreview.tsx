import { useSyncExternalStore } from 'react'
import type { Extension } from '@codemirror/state'
import { CodeMirrorReadonly } from './CodeMirrorReadonly'
import { codeLineHeight, type TargetLineRange } from './codeMirrorReadonlyExtensions'
import { useSyntaxHighlightRef } from '../hooks/useSyntaxHighlight'
import { themeStore } from '../store/themeStore'

interface CodePreviewProps {
  code: string
  language: string
  maxHeight?: number
  isResizing?: boolean
  isVisible?: boolean
  wordWrap?: boolean
  targetLine?: number | null
  targetKey?: string
  targetRanges?: readonly TargetLineRange[]
  /** 追加的 CodeMirror 扩展（如流式光标 streamingCaretExtension） */
  extraExtensions?: Extension[]
}

export function CodePreview({
  code,
  language,
  maxHeight,
  isResizing = false,
  isVisible = true,
  wordWrap,
  targetLine,
  targetKey,
  targetRanges,
  extraExtensions,
}: CodePreviewProps) {
  const { codeWordWrap, codeFontScale } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = wordWrap ?? codeWordWrap
  const { tokensRef, version } = useSyntaxHighlightRef(code, {
    lang: language,
    enabled: language !== 'text',
  })

  return (
    <CodeMirrorReadonly
      code={code}
      tokensRef={tokensRef}
      tokensVersion={version}
      wordWrap={resolvedWordWrap}
      lineHeight={codeLineHeight(codeFontScale)}
      maxHeight={maxHeight}
      isResizing={isResizing}
      isVisible={isVisible}
      targetLine={targetLine}
      targetKey={targetKey}
      targetRanges={targetRanges}
      extraExtensions={extraExtensions}
    />
  )
}

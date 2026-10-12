// ============================================
// Diff Preview
// ============================================

import type { DiffPreviewProps } from './FileExplorer.types'

// 当前未在 Files 预览中使用，保留供 Changes 面板等复用
export function DiffPreview({ hunks, isResizing = false }: DiffPreviewProps) {
  return (
    <div
      className={`font-mono text-[length:var(--fs-code)] leading-relaxed ${isResizing ? 'whitespace-pre overflow-hidden' : ''}`}
      style={{ contain: 'content' }}
    >
      {hunks.map((hunk, hunkIdx) => (
        <div key={hunkIdx} className="border-b border-border-100/30 last:border-0">
          {/* Hunk Header */}
          <div className="px-3 py-1 bg-bg-200/50 text-text-400 text-[length:var(--fs-xxs)]">
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </div>
          {/* Lines */}
          <div>
            {hunk.lines.map((line, lineIdx) => {
              const type = line[0]
              let bgClass = ''
              let textClass = 'text-text-300'

              if (type === '+') {
                bgClass = 'bg-success-100/10'
                textClass = 'text-success-100'
              } else if (type === '-') {
                bgClass = 'bg-danger-100/10'
                textClass = 'text-danger-100'
              }

              return (
                <div key={lineIdx} className={`px-3 py-0.5 ${bgClass} ${textClass}`}>
                  <span className="select-none opacity-50 w-4 inline-block">{type || ' '}</span>
                  <span>{line.slice(1)}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
// ============================================
// CommandProgressIndicator - 输入框上方命令进度提示
// ============================================
//
// 展示正在执行的 slash 命令（如 /init-graph）的 graph 进度：
// 环形百分比（current/total）+ 阶段 + 当前文件。
// phase === 'complete' 时不渲染（服务端随后发 command.executed 清除）。

import { CircularProgress } from '../../components/CircularProgress'
import { useCommandProgress } from '../../store/commandProgressStore'

export function CommandProgressIndicator({ sessionId }: { sessionId: string | null }) {
  const progress = useCommandProgress(sessionId ?? '')
  if (!sessionId || !progress || progress.phase === 'complete') return null

  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0

  return (
    <div className="px-3 py-1.5 glass border border-border-200/60 rounded-lg shadow-lg text-[length:var(--fs-sm)] text-text-300 animate-in fade-in slide-in-from-bottom-2 duration-150 flex items-center gap-2 max-w-[80vw]">
      <CircularProgress
        progress={percent / 100}
        size={16}
        strokeWidth={2}
        trackClassName="text-text-100/10"
        progressClassName={percent >= 100 ? 'text-success-100' : 'text-accent-main-100'}
      />
      <span className="truncate">
        {progress.name} · {progress.phase}
        {progress.total > 0 ? ` ${progress.current}/${progress.total}` : ''}
      </span>
      {progress.currentFile ? <span className="truncate text-text-500">{progress.currentFile}</span> : null}
    </div>
  )
}

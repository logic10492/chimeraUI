import { diffLines } from 'diff'
import type { Part, ToolPart, StepFinishPart } from '../../types/message'
import { isToolPart, isVisibleReasoningPart, isVisibleTextPart } from '../../types/message'
import type { RenderItem, SummarySegment, ToolSummaryCategory, ToolSummaryPhase } from './MessageRenderer.types'

/** 默认预览 8 行 */
export const COLLAPSE_PREVIEW_LINES = 8
export const USER_HTML_ARTIFACT_PATTERN =
  /(?:```(?:html|htm)\b|<!doctype\s+html\b|<html\b|<style\b|<script\b|<canvas\b|\son[a-z]+\s*=)/i
export const LEADING_RELAXED = 1.625

/** 用户需要阅读/交互的工具：沉浸模式下这些工具完成后保持展开 */
export const READABLE_TOOL_PATTERNS = /bash|\bsh\b|cmd|terminal|shell|write|save|edit|replace|patch|todo|question|ask/i

export function isReadableTool(toolName: string): boolean {
  return READABLE_TOOL_PATTERNS.test(toolName.toLowerCase())
}

export function formatTokens(
  tokens: StepFinishPart['tokens'],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  if (total >= 1000) {
    return t('tokensK', { count: (total / 1000).toFixed(1) })
  }
  return `${total} ${t('tokens')}`
}

export function buildDescriptiveToolStepsSummary(
  parts: ToolPart[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): SummarySegment[] {
  const sep = t('toolSteps.separator')
  const segments: SummarySegment[] = []
  const MAX_CATEGORIES = 3

  // ── 按类别汇总 done / failed / active ──
  const categoryOrder: ToolSummaryCategory[] = []
  const doneMap = new Map<ToolSummaryCategory, number>()
  const failedMap = new Map<ToolSummaryCategory, number>()
  const activeMap = new Map<ToolSummaryCategory, number>()

  for (const part of parts) {
    const cat = getToolSummaryCategory(part.tool)
    if (!doneMap.has(cat)) {
      categoryOrder.push(cat)
      doneMap.set(cat, 0)
      failedMap.set(cat, 0)
      activeMap.set(cat, 0)
    }
    if (part.state.status === 'completed') doneMap.set(cat, (doneMap.get(cat) || 0) + 1)
    else if (part.state.status === 'error') failedMap.set(cat, (failedMap.get(cat) || 0) + 1)
    else if (isToolPartActive(part)) activeMap.set(cat, (activeMap.get(cat) || 0) + 1)
  }

  // ── 已完成 + 失败（合并同类别）──
  // 先收集所有完成态类别（含纯失败的类别）
  const finishedCategories = categoryOrder.filter(cat => (doneMap.get(cat) || 0) > 0 || (failedMap.get(cat) || 0) > 0)

  const pushFinishedSegments = (cats: ToolSummaryCategory[]) => {
    for (const cat of cats) {
      const done = doneMap.get(cat) || 0
      const failed = failedMap.get(cat) || 0
      if (segments.length > 0) segments.push({ text: sep, type: 'normal' })

      if (done > 0 && failed > 0) {
        // 同类别既有成功又有失败：合并成一句
        const total = done + failed
        segments.push({ text: formatToolSummarySegment(cat, total, 'done', t), type: 'normal' })
        segments.push({ text: t('toolSteps.failedSuffix', { count: failed }), type: 'error' })
      } else if (done > 0) {
        segments.push({ text: formatToolSummarySegment(cat, done, 'done', t), type: 'normal' })
      } else {
        // 纯失败
        if (failed === 1) {
          segments.push({ text: formatToolSummarySegment(cat, failed, 'failed', t), type: 'error' })
        } else {
          segments.push({ text: formatToolSummarySegment(cat, failed, 'done', t), type: 'error' })
          segments.push({ text: t('toolSteps.failedAllSuffix'), type: 'error' })
        }
      }
    }
  }

  if (finishedCategories.length <= MAX_CATEGORIES) {
    pushFinishedSegments(finishedCategories)
  } else {
    pushFinishedSegments(finishedCategories.slice(0, MAX_CATEGORIES))
    const restCount = finishedCategories
      .slice(MAX_CATEGORIES)
      .reduce((sum, cat) => sum + (doneMap.get(cat) || 0) + (failedMap.get(cat) || 0), 0)
    segments.push({ text: sep, type: 'normal' })
    segments.push({ text: t('toolSteps.moreActions', { count: restCount }), type: 'normal' })
  }

  // ── 运行中 ──
  const activeCategories = categoryOrder.filter(cat => (activeMap.get(cat) || 0) > 0)
  for (const cat of activeCategories) {
    if (segments.length > 0) segments.push({ text: sep, type: 'normal' })
    segments.push({ text: formatToolSummarySegment(cat, activeMap.get(cat) || 0, 'active', t), type: 'active' })
  }

  if (segments.length === 0) {
    return [{ text: t('stepsCount', { done: 0, total: parts.length }), type: 'normal' }]
  }

  let isFirstContent = true
  for (const seg of segments) {
    if (seg.text === sep) continue
    if (isFirstContent) {
      isFirstContent = false
      continue
    }
    seg.text = seg.text.charAt(0).toLowerCase() + seg.text.slice(1)
  }

  return segments
}

export function formatToolSummarySegment(
  category: ToolSummaryCategory,
  count: number,
  phase: ToolSummaryPhase,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const key = `toolSteps.${category}${phase.charAt(0).toUpperCase()}${phase.slice(1)}`
  return t(key, { count })
}

export function getToolSummaryCategory(toolName: string): ToolSummaryCategory {
  const lower = toolName.toLowerCase()

  if (lower.includes('todo')) return 'todo'
  if (lower === 'task') return 'task'
  if (lower.includes('question') || lower.includes('ask')) return 'question'
  if (lower.includes('skill')) return 'skill'
  if (
    lower.includes('bash') ||
    lower === 'sh' ||
    lower.includes('cmd') ||
    lower.includes('terminal') ||
    lower.includes('shell')
  ) {
    return 'execute'
  }
  if (lower.includes('write') || lower.includes('save')) {
    return 'write'
  }
  if (lower.includes('edit') || lower.includes('replace') || lower.includes('patch')) {
    return 'edit'
  }
  if (
    lower.includes('web') ||
    lower.includes('fetch') ||
    lower.includes('http') ||
    lower.includes('browse') ||
    lower.includes('network') ||
    lower.includes('exa')
  ) {
    return 'network'
  }
  if (lower.includes('read') || lower.includes('cat')) return 'read'
  if (lower.includes('grep') || lower.includes('search')) return 'search'
  if (lower.includes('glob') || lower.includes('find')) return 'list'
  if (lower.includes('think') || lower.includes('reason') || lower.includes('plan')) return 'think'
  return 'other'
}

export function isToolPartActive(part: ToolPart): boolean {
  return part.state.status === 'running' || part.state.status === 'pending'
}

export function getTaskChildSessionId(part: ToolPart): string | undefined {
  if (part.tool.toLowerCase() !== 'task') return undefined
  const metadata = part.state.metadata as Record<string, unknown> | undefined
  return metadata?.sessionId as string | undefined
}

/** 从 extractToolData 的结果计算 diff stats（当 metadata 没给 diffStats 时） */
export function computePartDiffStats(data: {
  diff?: { before: string; after: string } | string
  files?: Array<{ before?: string; after?: string; additions?: number; deletions?: number }>
}): { additions: number; deletions: number } | undefined {
  if (data.files?.length) {
    let a = 0,
      d = 0
    for (const f of data.files) {
      if (f.additions !== undefined) a += f.additions
      if (f.deletions !== undefined) d += f.deletions
      if (f.additions === undefined && f.before !== undefined && f.after !== undefined) {
        const s = diffPairStats(f.before, f.after)
        a += s.additions
        d += s.deletions
      }
    }
    return a || d ? { additions: a, deletions: d } : undefined
  }
  if (data.diff && typeof data.diff === 'object') {
    const s = diffPairStats(data.diff.before, data.diff.after)
    return s.additions || s.deletions ? s : undefined
  }
  return undefined
}

export function diffPairStats(before: string, after: string): { additions: number; deletions: number } {
  const changes = diffLines(before, after)
  let additions = 0,
    deletions = 0
  for (const c of changes) {
    if (c.added) additions += c.count || 0
    if (c.removed) deletions += c.count || 0
  }
  return { additions, deletions }
}

/** parts[from..] 跳过基础设施和空内容后，下一个有意义的 part 是否为 tool */
export function hasMoreToolsAhead(parts: Part[], from: number): boolean {
  for (let k = from; k < parts.length; k++) {
    const part = parts[k]
    if (part.type === 'step-start' || part.type === 'step-finish' || part.type === 'snapshot' || part.type === 'patch')
      continue
    if (part.type === 'text' && !isVisibleTextPart(part)) continue
    if (part.type === 'reasoning' && !isVisibleReasoningPart(part)) continue
    return part.type === 'tool'
  }
  return false
}

export function groupPartsForRender(parts: Part[]): RenderItem[] {
  const result: RenderItem[] = []
  let toolGroup: ToolPart[] = []
  let stepFinish: StepFinishPart | undefined

  const flushToolGroup = (sf?: StepFinishPart) => {
    if (toolGroup.length === 0) return
    result.push({ type: 'tool-group', parts: toolGroup, stepFinish: sf })
    toolGroup = []
    stepFinish = undefined
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    // 跳过不渲染的 parts
    if (part.type === 'step-start' || part.type === 'snapshot' || part.type === 'patch') continue
    if (part.type === 'text' && !isVisibleTextPart(part)) continue
    if (part.type === 'reasoning' && !isVisibleReasoningPart(part)) continue

    if (isToolPart(part)) {
      toolGroup.push(part)
    } else if (part.type === 'step-finish') {
      if (toolGroup.length > 0 && hasMoreToolsAhead(parts, i + 1)) {
        // 中间 step-finish：后面还有 tool，暂存不 flush
        stepFinish = part
      } else if (toolGroup.length > 0) {
        // 最后一个 step-finish，结束 tool group
        flushToolGroup(part)
      } else {
        result.push({ type: 'single', part })
      }
    } else {
      flushToolGroup(stepFinish)
      result.push({ type: 'single', part })
    }
  }

  flushToolGroup(stepFinish)
  return result
}
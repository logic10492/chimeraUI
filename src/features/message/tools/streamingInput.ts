// ============================================
// streamingInput — 从截断的 tool args 原始 JSON 片段（part.state.raw）中
// 容错提取「正在增长」的预览文本。
// 任何截断点 / 非法输入都不得抛异常：返回目前已解码到的部分。
// ============================================

export interface StreamingEditOpPreview {
  op?: string
  pos?: string
  end?: string
  /** 已完成的行按 \n 拼接 + 当前正在输入的最后一行 */
  linesText: string
  /** 该条目的 lines 值与对象本体都已闭合时为 true */
  complete: boolean
}

export interface StreamingEditsPreview {
  filePath?: string
  ops: StreamingEditOpPreview[]
}

/** edit-like 工具判定（与 registry 的 edit 匹配器一致）：完成态按 hunk 拆分展示 */
export function isEditLikeTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('edit') || lower.includes('replace') || lower.includes('patch')
}

const PATCH_FILE_LINE = /\*\*\*\s+(?:Add|Update|Delete) File:\s*(.+)/

/** 从增长中的 apply_patch 文本里提取第一个文件路径（用于提前显示目标文件） */
export function firstPatchFilePath(patchText: string): string | undefined {
  const match = patchText.match(PATCH_FILE_LINE)
  return match?.[1]?.trim() || undefined
}

function isWs(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r'
}

function skipWs(raw: string, i: number): number {
  while (i < raw.length && isWs(raw[i])) i += 1
  return i
}

interface DecodedString {
  value: string
  end: number
  complete: boolean
}

/** raw[i] 必须为 '"'；字符串或转义未闭合时返回已解码部分（不抛异常） */
function readString(raw: string, i: number): DecodedString {
  let value = ''
  i += 1
  while (i < raw.length) {
    const c = raw[i]
    if (c === '"') return { value, end: i + 1, complete: true }
    if (c !== '\\') {
      value += c
      i += 1
      continue
    }
    const n = raw[i + 1]
    if (n === 'n') value += '\n'
    else if (n === 't') value += '\t'
    else if (n === 'r') value += '\r'
    else if (n === 'b') value += '\b'
    else if (n === 'f') value += '\f'
    else if (n === '"' || n === '\\' || n === '/') value += n
    else if (n === 'u') {
      const hex = raw.slice(i + 2, i + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { value, end: i, complete: false }
      value += String.fromCharCode(parseInt(hex, 16))
      i += 6
      continue
    } else {
      return { value, end: i, complete: false }
    }
    i += 2
  }
  return { value, end: i, complete: false }
}

/** 跳过任意 JSON 值；未闭合的容器/字面量返回 raw.length */
function skipValue(raw: string, i: number): number {
  i = skipWs(raw, i)
  const c = raw[i]
  if (c === '"') return readString(raw, i).end
  if (c === '{' || c === '[') {
    let depth = 0
    for (let j = i; j < raw.length; j += 1) {
      const ch = raw[j]
      if (ch === '"') {
        j = readString(raw, j).end - 1
        continue
      }
      if (ch === '{' || ch === '[') depth += 1
      else if (ch === '}' || ch === ']') {
        depth -= 1
        if (depth === 0) return j + 1
      }
    }
    return raw.length
  }
  let j = i
  while (j < raw.length && raw[j] !== ',' && raw[j] !== '}' && raw[j] !== ']') j += 1
  return j
}

/**
 * 顶层字符串字段当前已解码到的值。
 * 字段不存在或非字符串值返回 undefined；字符串未闭合返回已解码部分。
 */
export function extractStreamingString(raw: string, key: string): string | undefined {
  if (!raw) return undefined
  let i = skipWs(raw, 0)
  if (raw[i] !== '{') return undefined
  i = skipWs(raw, i + 1)
  while (i < raw.length) {
    if (raw[i] !== '"') return undefined
    const k = readString(raw, i)
    if (!k.complete) return undefined
    i = skipWs(raw, k.end)
    if (raw[i] !== ':') return undefined
    i = skipWs(raw, i + 1)
    if (k.value === key) return raw[i] === '"' ? readString(raw, i).value : undefined
    i = skipWs(raw, skipValue(raw, i))
    if (raw[i] !== ',') return undefined
    i = skipWs(raw, i + 1)
  }
  return undefined
}

/** lines 字符串数组：已闭合元素 + 当前正在增长的最后一个元素 */
function readLinesArray(raw: string, i: number): { lines: string[]; end: number; complete: boolean } {
  const lines: string[] = []
  i += 1
  for (;;) {
    i = skipWs(raw, i)
    if (i >= raw.length) return { lines, end: i, complete: false }
    if (raw[i] === ']') return { lines, end: i + 1, complete: true }
    if (raw[i] !== '"') return { lines, end: i, complete: false }
    const v = readString(raw, i)
    lines.push(v.value)
    if (!v.complete) return { lines, end: v.end, complete: false }
    i = skipWs(raw, v.end)
    if (raw[i] === ',') i += 1
    else if (raw[i] !== ']') return { lines, end: i, complete: false }
  }
}

interface ParsedEditOp {
  op: StreamingEditOpPreview
  end: number
  /** op 对象本体是否已闭合（lines 是否闭合记录在 op.complete 中） */
  objClosed: boolean
}

/** raw[i] 必须为 '{'，解析单个 edit op 对象 */
function readEditOp(raw: string, i: number): ParsedEditOp {
  const op: StreamingEditOpPreview = { linesText: '', complete: false }
  let linesClosed = false
  i += 1
  while (i < raw.length) {
    i = skipWs(raw, i)
    if (raw[i] === '}') {
      op.complete = linesClosed
      return { op, end: i + 1, objClosed: true }
    }
    if (raw[i] !== '"') break
    const k = readString(raw, i)
    if (!k.complete) break
    i = skipWs(raw, k.end)
    if (raw[i] !== ':') break
    i = skipWs(raw, i + 1)
    if (k.value === 'lines' && raw[i] === '[') {
      const arr = readLinesArray(raw, i)
      op.linesText = arr.lines.join('\n')
      linesClosed = arr.complete
      i = arr.end
    } else if (raw[i] === '"') {
      const v = readString(raw, i)
      if (k.value === 'op') op.op = v.value
      else if (k.value === 'pos') op.pos = v.value
      else if (k.value === 'end') op.end = v.value
      else if (k.value === 'lines') {
        op.linesText = v.value
        linesClosed = v.complete
      }
      i = v.end
    } else {
      i = skipValue(raw, i)
    }
    i = skipWs(raw, i)
    if (raw[i] === ',') {
      i += 1
      continue
    }
    if (raw[i] === '}') {
      op.complete = linesClosed
      return { op, end: i + 1, objClosed: true }
    }
    break
  }
  return { op, end: i, objClosed: false }
}

/** raw[i] 必须为 '['（edits 数组的值起点） */
function readEditsArray(raw: string, i: number): StreamingEditOpPreview[] {
  const ops: StreamingEditOpPreview[] = []
  i += 1
  for (;;) {
    i = skipWs(raw, i)
    if (i >= raw.length || raw[i] !== '{') return ops
    const parsed = readEditOp(raw, i)
    ops.push(parsed.op)
    if (!parsed.objClosed) return ops
    i = skipWs(raw, parsed.end)
    if (raw[i] === ',') {
      i += 1
      continue
    }
    return ops
  }
}

/**
 * 解析 hashline edit 的 args：{"filePath": "...", "edits": [{"op","pos","end","lines"}...]}。
 * 对任意截断点容错；edits 之后的字段不再关注。
 */
export function extractStreamingEdits(raw: string): StreamingEditsPreview {
  const result: StreamingEditsPreview = { ops: [] }
  if (!raw) return result
  let i = skipWs(raw, 0)
  if (raw[i] !== '{') return result
  i = skipWs(raw, i + 1)
  while (i < raw.length && raw[i] !== '}') {
    if (raw[i] !== '"') break
    const k = readString(raw, i)
    if (!k.complete) break
    i = skipWs(raw, k.end)
    if (raw[i] !== ':') break
    i = skipWs(raw, i + 1)
    if (k.value === 'filePath' && raw[i] === '"') {
      result.filePath = readString(raw, i).value
      i = skipWs(raw, i)
      i = skipValue(raw, i)
    } else if (k.value === 'edits' && raw[i] === '[') {
      result.ops = readEditsArray(raw, i)
      break
    } else {
      i = skipValue(raw, i)
    }
    i = skipWs(raw, i)
    if (raw[i] !== ',') break
    i = skipWs(raw, i + 1)
  }
  return result
}

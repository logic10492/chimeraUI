export function extractContentFromUnifiedDiff(diff: string): { before: string; after: string } {
  let before = ''
  let after = ''

  for (const line of diff.split('\n')) {
    if (
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('Index:') ||
      line.startsWith('===') ||
      line.startsWith('@@') ||
      line.startsWith('\\ No newline')
    ) {
      continue
    }

    if (line.startsWith('-')) {
      before += line.slice(1) + '\n'
    } else if (line.startsWith('+')) {
      after += line.slice(1) + '\n'
    } else if (line.startsWith(' ')) {
      before += line.slice(1) + '\n'
      after += line.slice(1) + '\n'
    }
  }

  return { before: before.trimEnd(), after: after.trimEnd() }
}

/**
 * 按 `@@` hunk 头拆分 unified diff，头行保留在每个 hunk 开头；
 * 文件头（---/+++/Index:/===）归属第一个 hunk。无 hunk 头时返回单片原文。
 */
export function splitUnifiedDiffHunks(diff: string): string[] {
  if (!diff.trim()) return []
  const pieces: string[] = []
  let current: string[] = []
  let seenHunk = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      if (seenHunk && current.length > 0) {
        pieces.push(current.join('\n'))
        current = []
      }
      seenHunk = true
    }
    current.push(line)
  }
  if (current.length > 0) pieces.push(current.join('\n'))
  return pieces
}

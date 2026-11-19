// ============================================
// Open a local file path in the right-side file tab
// ============================================
import { layoutStore } from '../store/layoutStore'
import { parseLocalFilePath } from './localFilePath'

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

/**
 * 尝试把点击的路径打开到右侧文件预览 tab。
 * - 相对路径：直接打开（FileExplorer 用自己的 directory 解析）
 * - 绝对路径且位于 directory 下：相对化后打开
 * - 其余（项目外绝对路径、非法形状）：返回 false，调用方回退 legacy openPath
 */
export function openFileInPanel(rawPath: string, directory?: string): boolean {
  const parsed = parseLocalFilePath(rawPath, { allowBareFilename: true })
  if (!parsed) return false

  const normalized = parsed.path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const targetLine = parsed.targetLine == null ? {} : { targetLine: parsed.targetLine }

  if (!isAbsolutePath(normalized)) {
    layoutStore.openFilePreview({ path: normalized, name: basename(normalized), ...targetLine }, 'right')
    return true
  }

  const dir = directory?.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!dir || !normalized.startsWith(`${dir}/`)) return false

  const relativePath = normalized.slice(dir.length + 1)
  layoutStore.openFilePreview({ path: relativePath, name: basename(relativePath), ...targetLine }, 'right')
  return true
}
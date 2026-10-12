import { isSameDirectory } from '../../../utils'
import type { ProjectItem } from './SidePanel.types'

// 缺失 session 补拉失败后的重试抑制窗口（毫秒）：窗口内跳过避免请求风暴，窗口过后自动重试
export const MISSING_SESSION_RETRY_WINDOW_MS = 4000

export function getSelectionRange(visibleIds: string[], anchorId: string, targetId: string) {
  const startIndex = visibleIds.indexOf(anchorId)
  const endIndex = visibleIds.indexOf(targetId)

  if (startIndex === -1 || endIndex === -1) return null

  const from = Math.min(startIndex, endIndex)
  const to = Math.max(startIndex, endIndex)
  return visibleIds.slice(from, to + 1)
}

export function findProjectGroupForDirectory(projects: ProjectItem[], directory: string) {
  return projects.find(project => {
    if (isSameDirectory(project.id, directory) || isSameDirectory(project.worktree, directory)) {
      return true
    }

    if (project.workspaceDirectories?.some(workspace => isSameDirectory(workspace, directory))) {
      return true
    }

    if (project.memberDirectories?.some(memberDirectory => isSameDirectory(memberDirectory, directory))) {
      return true
    }

    return false
  })
}
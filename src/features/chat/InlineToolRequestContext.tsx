/**
 * InlineToolRequestContext
 *
 * 把待处理的权限请求和提问请求注入到消息流里，
 * 让工具视图可以在对应位置直接渲染内嵌交互。
 * 对于 task 类型的 tool，只匹配它直接拥有的 child session 请求，避免祖先 task 重复渲染。
 */

import { createContext, useContext } from 'react'
import type { ApiPermissionRequest, ApiQuestionRequest, PermissionReply, QuestionAnswer } from '../../api'
import { isToolPart, type Message, type ToolPart } from '../../types/message'

export interface InlineToolRequestContextValue {
  /** 当前 pending 的权限请求 */
  pendingPermissions: ApiPermissionRequest[]
  /** 当前 pending 的提问请求 */
  pendingQuestions: ApiQuestionRequest[]
  /** 回复权限 */
  onPermissionReply: (requestId: string, reply: PermissionReply) => void
  /** 回复提问 */
  onQuestionReply: (requestId: string, answers: QuestionAnswer[]) => void
  /** 拒绝提问 */
  onQuestionReject: (requestId: string) => void
  /** 是否正在发送回复 */
  isReplying: boolean
}

const defaultValue: InlineToolRequestContextValue = {
  pendingPermissions: [],
  pendingQuestions: [],
  onPermissionReply: () => {},
  onQuestionReply: () => {},
  onQuestionReject: () => {},
  isReplying: false,
}

export const InlineToolRequestContext = createContext<InlineToolRequestContextValue>(defaultValue)

export function useInlineToolRequests() {
  return useContext(InlineToolRequestContext)
}

/**
 * 根据 callID 查找关联的权限请求。
 * 对于 task tool，额外传入 childSessionId，
 * 只匹配该 task 直接拥有的 child session。
 */
export function findPermissionRequestForTool(
  pendingPermissions: ApiPermissionRequest[],
  callID: string,
  childSessionId?: string,
): ApiPermissionRequest | undefined {
  // 先按 callID 精确匹配（直接工具调用）
  const direct = pendingPermissions.find(p => p.tool?.callID === callID)
  if (direct) return direct

  if (childSessionId) {
    return pendingPermissions.find(p => p.sessionID === childSessionId)
  }

  return undefined
}

/**
 * 根据 callID 查找关联的提问请求。
 * 对于 task tool，额外传入 childSessionId。
 */
export function findQuestionRequestForTool(
  pendingQuestions: ApiQuestionRequest[],
  callID: string,
  childSessionId?: string,
): ApiQuestionRequest | undefined {
  const direct = pendingQuestions.find(q => q.tool?.callID === callID)
  if (direct) return direct

  if (childSessionId) {
    return pendingQuestions.find(q => q.sessionID === childSessionId)
  }

  return undefined
}

export function findUnmatchedInlineToolRequests(
  messages: Message[],
  pendingPermissions: ApiPermissionRequest[],
  pendingQuestions: ApiQuestionRequest[],
) {
  const matchedPermissionIds = new Set<string>()
  const matchedQuestionIds = new Set<string>()

  messages
    .flatMap(message => message.parts.filter(isToolPart))
    .forEach(part => {
      const childSessionId = getTaskChildSessionId(part)
      const permission = findPermissionRequestForTool(pendingPermissions, part.callID, childSessionId)
      const question = findQuestionRequestForTool(pendingQuestions, part.callID, childSessionId)
      if (permission) matchedPermissionIds.add(permission.id)
      if (question) matchedQuestionIds.add(question.id)
    })

  return {
    permissions: pendingPermissions.filter(request => !matchedPermissionIds.has(request.id)),
    questions: pendingQuestions.filter(request => !matchedQuestionIds.has(request.id)),
  }
}

function getTaskChildSessionId(part: ToolPart): string | undefined {
  if (part.tool.toLowerCase() !== 'task') return undefined
  const metadata = part.state.metadata as Record<string, unknown> | undefined
  return typeof metadata?.sessionId === 'string' ? metadata.sessionId : undefined
}

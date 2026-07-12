import { describe, expect, it } from 'vitest'
import type { ApiPermissionRequest, ApiQuestionRequest } from '../../api'
import type { Message } from '../../types/message'
import { findUnmatchedInlineToolRequests } from './InlineToolRequestContext'

const permission = (id: string, callID?: string, sessionID = 'session-1'): ApiPermissionRequest => ({
  id,
  sessionID,
  permission: 'bash',
  patterns: ['npm test'],
  metadata: {},
  always: [],
  tool: callID ? { callID } : undefined,
})

const question = (id: string, callID?: string, sessionID = 'session-1'): ApiQuestionRequest => ({
  id,
  sessionID,
  questions: [{ question: 'Continue?', header: 'Question', options: [], multiple: false }],
  tool: callID ? { callID } : undefined,
})

const messageWithTool = (callID: string): Message =>
  ({
    info: { id: 'message-1', role: 'assistant' },
    parts: [{ id: 'part-1', type: 'tool', callID, tool: 'bash', state: { status: 'running', input: {} } }],
  }) as Message

const messageWithTask = (callID: string, childSessionId: string): Message =>
  ({
    info: { id: 'message-task', role: 'assistant' },
    parts: [
      {
        id: 'part-task',
        type: 'tool',
        callID,
        tool: 'task',
        state: { status: 'running', input: {}, metadata: { sessionId: childSessionId } },
      },
    ],
  }) as Message

describe('findUnmatchedInlineToolRequests', () => {
  it('keeps only requests not claimed by a rendered tool', () => {
    const result = findUnmatchedInlineToolRequests(
      [messageWithTool('call-present')],
      [
        permission('permission-matched', 'call-present'),
        permission('permission-stale', 'call-missing'),
        permission('permission-no-call'),
      ],
      [
        question('question-matched', 'call-present'),
        question('question-stale', 'call-missing'),
        question('question-no-call'),
      ],
    )

    expect(result.permissions.map(request => request.id)).toEqual(['permission-stale', 'permission-no-call'])
    expect(result.questions.map(request => request.id)).toEqual(['question-stale', 'question-no-call'])
  })

  it('does not let an ancestor task claim a descendant session request', () => {
    const result = findUnmatchedInlineToolRequests(
      [messageWithTask('task-call', 'session-child')],
      [
        permission('permission-direct', undefined, 'session-child'),
        permission('permission-descendant', undefined, 'session-grandchild'),
      ],
      [
        question('question-direct', undefined, 'session-child'),
        question('question-descendant', undefined, 'session-grandchild'),
      ],
    )

    expect(result.permissions.map(request => request.id)).toEqual(['permission-descendant'])
    expect(result.questions.map(request => request.id)).toEqual(['question-descendant'])
  })
})

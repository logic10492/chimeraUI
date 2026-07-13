import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPartOutput, getSessionMessageCount, getSessionMessagesPage } from './message'

const messagesMock = vi.fn()
const messageMock = vi.fn()

vi.mock('./sdk', () => ({
  getSDKClient: () => ({
    session: {
      messages: (...args: unknown[]) => messagesMock(...args),
      message: (...args: unknown[]) => messageMock(...args),
    },
  }),
  unwrap: (result: { data?: unknown; error?: unknown }) => {
    if (result.error != null) throw result.error
    return result.data
  },
}))

describe('message API contract', () => {
  beforeEach(() => {
    messagesMock.mockReset()
    messageMock.mockReset()
  })

  it('returns the opaque next cursor from the fixed-size message page', async () => {
    const messages = [{ info: { id: 'message-1' }, parts: [] }]
    messagesMock.mockResolvedValue({
      data: messages,
      response: { headers: new Headers({ 'x-next-cursor': 'cursor-2' }) },
    })

    await expect(
      getSessionMessagesPage('session-1', 25, '/workspace/project/', { before: 'cursor-1' }),
    ).resolves.toEqual({ items: messages, nextCursor: 'cursor-2' })

    expect(messagesMock).toHaveBeenCalledWith({
      sessionID: 'session-1',
      directory: '/workspace/project',
      limit: 25,
      before: 'cursor-1',
    })
  })

  it('uses limit zero when counting all session messages', async () => {
    messagesMock.mockResolvedValue({ data: [{}, {}, {}] })

    await expect(getSessionMessageCount('session-1')).resolves.toBe(3)
    expect(messagesMock).toHaveBeenCalledWith({
      sessionID: 'session-1',
      directory: undefined,
      limit: 0,
      before: undefined,
    })
  })

  it('loads completed tool output from the current message detail route', async () => {
    const attachment = {
      id: 'file-1',
      sessionID: 'session-1',
      messageID: 'message-1',
      type: 'file',
      mime: 'text/plain',
      url: 'file:///tmp/output.txt',
    }
    messageMock.mockResolvedValue({
      data: {
        info: { id: 'message-1' },
        parts: [
          {
            id: 'part-1',
            sessionID: 'session-1',
            messageID: 'message-1',
            type: 'tool',
            callID: 'call-1',
            tool: 'bash',
            state: {
              status: 'completed',
              input: {},
              output: 'full output',
              title: 'Run command',
              metadata: {},
              time: { start: 1, end: 2 },
              attachments: [attachment],
            },
          },
        ],
      },
    })

    await expect(getPartOutput('session-1', 'message-1', 'part-1', '/workspace/project/')).resolves.toEqual({
      output: 'full output',
      attachments: [attachment],
    })
    expect(messageMock).toHaveBeenCalledWith({
      sessionID: 'session-1',
      messageID: 'message-1',
      directory: '/workspace/project',
    })
  })

  it('returns tool errors and ignores parts without final output', async () => {
    messageMock
      .mockResolvedValueOnce({
        data: {
          info: { id: 'message-1' },
          parts: [{ id: 'part-1', type: 'tool', state: { status: 'error', error: 'command failed' } }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          info: { id: 'message-1' },
          parts: [{ id: 'part-1', type: 'tool', state: { status: 'pending' } }],
        },
      })
      .mockResolvedValueOnce({ data: { info: { id: 'message-1' }, parts: [{ id: 'part-1', type: 'text' }] } })
      .mockResolvedValueOnce({ data: { info: { id: 'message-1' }, parts: [] } })

    await expect(getPartOutput('session-1', 'message-1', 'part-1')).resolves.toEqual({ error: 'command failed' })
    await expect(getPartOutput('session-1', 'message-1', 'part-1')).resolves.toBeNull()
    await expect(getPartOutput('session-1', 'message-1', 'part-1')).resolves.toBeNull()
    await expect(getPartOutput('session-1', 'message-1', 'part-1')).resolves.toBeNull()
  })
})

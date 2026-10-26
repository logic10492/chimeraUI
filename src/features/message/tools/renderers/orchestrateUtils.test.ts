import { describe, expect, it } from 'vitest'
import type { Message, ToolPart } from '../../../../types/message'
import {
  getOrchestrateAgents,
  getOrchestrateRuns,
  getOrchestrateSessionIds,
  getOrchestrateStats,
  normalizeOrchestrateAgentStatus,
  resolveOrchestrateAgentStatus,
} from './orchestrateUtils'

function createToolPart(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    id: 'orchestrate-1',
    sessionID: 'parent',
    messageID: 'message-1',
    type: 'tool',
    callID: 'call-1',
    tool: 'orchestrate',
    state: {
      status: 'running',
      input: {},
      title: 'Fan out review',
      metadata: {},
    },
    ...overrides,
  }
}

function createMessage(parts: Message['parts']): Message {
  return { info: { id: 'message-1' } as Message['info'], parts }
}

describe('normalizeOrchestrateAgentStatus', () => {
  it('maps terminal metadata statuses and treats agents without a session as queued', () => {
    expect(normalizeOrchestrateAgentStatus('completed', 'child-1')).toBe('completed')
    expect(normalizeOrchestrateAgentStatus('success', 'child-1')).toBe('completed')
    expect(normalizeOrchestrateAgentStatus('failed', 'child-1')).toBe('error')
    expect(normalizeOrchestrateAgentStatus('failure', 'child-1')).toBe('error')
    expect(normalizeOrchestrateAgentStatus('aborted', 'child-1')).toBe('cancelled')
    expect(normalizeOrchestrateAgentStatus('running', undefined)).toBe('queued')
    expect(normalizeOrchestrateAgentStatus(undefined, 'child-1')).toBe('running')
    expect(normalizeOrchestrateAgentStatus('queued', 'child-1')).toBe('queued')
  })
})

describe('getOrchestrateAgents', () => {
  it('normalizes valid agents, defaults labels, and skips malformed entries', () => {
    const agents = getOrchestrateAgents({
      agents: [
        { label: 'Review', agent: 'reviewer', sessionId: 'child-1', status: 'running' },
        { sessionId: 'child-2', status: 'completed' },
        null,
        'bad',
        { label: 'Queued', agent: 'general', status: 'running' },
      ],
    })

    expect(agents).toEqual([
      {
        index: 1,
        label: 'Review',
        agent: 'reviewer',
        status: 'running',
        sessionId: 'child-1',
        error: undefined,
      },
      {
        index: 2,
        label: 'Agent 2',
        agent: 'general',
        status: 'completed',
        sessionId: 'child-2',
        error: undefined,
      },
      {
        index: 5,
        label: 'Queued',
        agent: 'general',
        status: 'queued',
        sessionId: undefined,
        error: undefined,
      },
    ])
  })

  it('returns an empty list for missing or non-array metadata', () => {
    expect(getOrchestrateAgents(undefined)).toEqual([])
    expect(getOrchestrateAgents({ agents: 'nope' })).toEqual([])
  })
})

describe('getOrchestrateRuns', () => {
  it('only keeps orchestrate tool parts and extracts title, code, output and errors', () => {
    const runs = getOrchestrateRuns([
      createMessage([
        createToolPart({
          id: 'run-1',
          state: {
            status: 'completed',
            input: { code: 'await orche.parallel([])', description: 'From input' },
            title: 'From title',
            output: '## Result\nok',
            metadata: { agents: [{ label: 'A', agent: 'general', sessionId: 'child-1', status: 'completed' }] },
          },
        }),
        createToolPart({ id: 'bash-1', tool: 'bash', state: { status: 'completed', input: {}, output: 'x', title: 'bash' } }),
      ]),
      createMessage([
        createToolPart({
          id: 'run-2',
          state: { status: 'error', input: {}, error: 'boom', metadata: { agents: [] } },
        }),
      ]),
    ])

    expect(runs.map(run => run.id)).toEqual(['run-1', 'run-2'])
    expect(runs[0]).toMatchObject({
      title: 'From title',
      status: 'completed',
      code: 'await orche.parallel([])',
      output: '## Result\nok',
      agents: [expect.objectContaining({ label: 'A', status: 'completed' })],
    })
    expect(runs[1]).toMatchObject({ title: '', status: 'error', error: 'boom', agents: [] })
  })

  it('falls back to the input description and metadata error', () => {
    const runs = getOrchestrateRuns([
      createMessage([
        createToolPart({
          state: {
            status: 'error',
            input: { description: 'Input title' },
            metadata: { error: 'metadata boom' },
          },
        }),
      ]),
    ])

    expect(runs[0]?.title).toBe('Input title')
    expect(runs[0]?.error).toBe('metadata boom')
  })
})

describe('resolveOrchestrateAgentStatus', () => {
  it('turns a still-running agent into cancelled when the orchestrate part errored', () => {
    expect(resolveOrchestrateAgentStatus('running', 'error', 'running')).toBe('cancelled')
    expect(resolveOrchestrateAgentStatus('running', 'completed', 'running')).toBe('running')
    expect(resolveOrchestrateAgentStatus('running', 'error', 'completed')).toBe('completed')
  })
})

describe('getOrchestrateStats and session ids', () => {
  it('counts statuses and deduplicates child session ids', () => {
    const agents = getOrchestrateAgents({
      agents: [
        { label: 'a', sessionId: 'child-1', status: 'running' },
        { label: 'b', sessionId: 'child-1', status: 'completed' },
        { label: 'c', sessionId: 'child-2', status: 'failed' },
        { label: 'd', sessionId: 'child-3', status: 'aborted' },
        { label: 'e', status: 'running' },
      ],
    })

    expect(getOrchestrateStats(agents)).toEqual({
      total: 5,
      queued: 1,
      running: 1,
      completed: 1,
      failed: 1,
      cancelled: 1,
    })
    expect(getOrchestrateSessionIds([{ id: 'run', title: '', status: 'running', agents }])).toEqual([
      'child-1',
      'child-2',
      'child-3',
    ])
  })
})
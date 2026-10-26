import { describe, expect, it } from 'vitest'
import type { Message, ToolPart } from '../../../../types/message'
import {
  getCurrentStageIndex,
  getOrchestrateAgents,
  getOrchestrateLogs,
  getOrchestrateRuns,
  getOrchestrateSessionIds,
  getOrchestrateStats,
  groupAgentsByStage,
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

describe('groupAgentsByStage', () => {
  const agents = getOrchestrateAgents({
    agents: [
      { label: 'loc-struct:codex', sessionId: 'child-1', status: 'completed' },
      { label: 'loc-struct:codex#2', sessionId: 'child-2', status: 'running' },
      { label: 'synthesis', sessionId: 'child-3', status: 'completed' },
      { label: 'analyze:codex#3', sessionId: 'child-4', status: 'failed' },
      { label: 'analyze:codex#4', sessionId: 'child-5', status: 'completed' },
    ],
  })

  it('groups by the first colon prefix in first-appearance order and aggregates status', () => {
    const stages = groupAgentsByStage(agents)

    expect(stages.map(stage => stage.name)).toEqual(['loc-struct', 'synthesis', 'analyze'])
    expect(stages.map(stage => stage.status)).toEqual(['running', 'completed', 'error'])
    expect(stages.map(stage => stage.index)).toEqual([1, 2, 3])
    expect(stages[0]?.stats).toMatchObject({ total: 2, running: 1, completed: 1 })
    expect(getCurrentStageIndex(stages)).toBe(0)
  })

  it('falls back to the last stage when no stage is running', () => {
    const done = agents.map(agent => ({ ...agent, status: 'completed' as const }))
    const stages = groupAgentsByStage(done)

    expect(stages.every(stage => stage.status === 'completed')).toBe(true)
    expect(getCurrentStageIndex(stages)).toBe(stages.length - 1)
  })

  it('treats cancelled agents as a failed stage and returns no current stage for an empty run', () => {
    const stages = groupAgentsByStage([{ ...agents[0]!, status: 'cancelled' }])

    expect(stages[0]?.status).toBe('error')
    expect(groupAgentsByStage([])).toEqual([])
    expect(getCurrentStageIndex([])).toBe(-1)
  })
})

describe('getOrchestrateLogs', () => {
  it('keeps string lines and tolerates missing or malformed logs', () => {
    expect(getOrchestrateLogs({ logs: ['one', 2, null, 'two'] })).toEqual(['one', 'two'])
    expect(getOrchestrateLogs({})).toEqual([])
    expect(getOrchestrateLogs(undefined)).toEqual([])
    expect(getOrchestrateLogs({ logs: 'nope' })).toEqual([])
  })
})
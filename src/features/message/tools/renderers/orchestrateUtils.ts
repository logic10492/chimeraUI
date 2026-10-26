import type { Message, ToolPart } from '../../../../types/message'

export const ORCHESTRATE_TOOL = 'orchestrate'

export type OrchestrateAgentStatus = 'queued' | 'running' | 'completed' | 'error' | 'cancelled'
export type OrchestrateRunStatus = 'running' | 'completed' | 'error'

export interface OrchestrateAgentRun {
  index: number
  label: string
  agent: string
  status: OrchestrateAgentStatus
  sessionId?: string
  error?: string
}

export interface OrchestrateRun {
  id: string
  title: string
  status: OrchestrateRunStatus
  code?: string
  output?: string
  error?: string
  agents: OrchestrateAgentRun[]
}

export interface OrchestrateStats {
  total: number
  queued: number
  running: number
  completed: number
  failed: number
  cancelled: number
}

export function isOrchestrateTool(tool: string): boolean {
  return tool.toLowerCase() === ORCHESTRATE_TOOL
}

/**
 * Map the orchestrate metadata status onto the UI status vocabulary.
 * Explicit terminal states win; an agent without a session id has not started
 * yet, so it is queued regardless of the optimistic "running" metadata.
 */
export function normalizeOrchestrateAgentStatus(status: unknown, sessionId?: string): OrchestrateAgentStatus {
  if (status === 'completed' || status === 'success') return 'completed'
  if (status === 'failed' || status === 'failure' || status === 'error') return 'error'
  if (status === 'aborted' || status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (!sessionId) return 'queued'
  if (status === 'queued') return 'queued'
  return 'running'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export function getOrchestrateAgents(metadata: unknown): OrchestrateAgentRun[] {
  const record = asRecord(metadata)
  const rawAgents = record?.agents
  if (!Array.isArray(rawAgents)) return []

  return rawAgents.flatMap((raw, position): OrchestrateAgentRun[] => {
    const agent = asRecord(raw)
    if (!agent) return []

    const sessionId = typeof agent.sessionId === 'string' && agent.sessionId ? agent.sessionId : undefined
    return [
      {
        index: position + 1,
        label:
          typeof agent.label === 'string' && agent.label.trim() ? agent.label : `Agent ${position + 1}`,
        agent: typeof agent.agent === 'string' && agent.agent.trim() ? agent.agent : 'general',
        status: normalizeOrchestrateAgentStatus(agent.status, sessionId),
        sessionId,
        error: typeof agent.error === 'string' ? agent.error : undefined,
      },
    ]
  })
}

export function getOrchestrateRuns(messages: Message[]): OrchestrateRun[] {
  return messages.flatMap(message =>
    message.parts.flatMap((part): OrchestrateRun[] => {
      if (part.type !== 'tool' || !isOrchestrateTool(part.tool)) return []

      const toolPart: ToolPart = part
      const input = asRecord(toolPart.state.input)
      const metadata = asRecord(toolPart.state.metadata)
      const status: OrchestrateRunStatus =
        toolPart.state.status === 'error' ? 'error' : toolPart.state.status === 'completed' ? 'completed' : 'running'
      const title =
        typeof toolPart.state.title === 'string' && toolPart.state.title
          ? toolPart.state.title
          : typeof input?.description === 'string'
            ? input.description
            : ''

      return [
        {
          id: toolPart.id,
          title,
          status,
          code: typeof input?.code === 'string' ? input.code : undefined,
          output: typeof toolPart.state.output === 'string' ? toolPart.state.output : undefined,
          error:
            typeof toolPart.state.error === 'string'
              ? toolPart.state.error
              : typeof metadata?.error === 'string'
                ? metadata.error
                : undefined,
          agents: getOrchestrateAgents(toolPart.state.metadata),
        },
      ]
    }),
  )
}

/**
 * A failed orchestrate part must not leave a child stuck in "running" forever:
 * once the tool itself errored, any still-running agent is treated as cancelled.
 */
export function resolveOrchestrateAgentStatus(
  status: OrchestrateAgentStatus,
  runStatus: OrchestrateRunStatus,
  liveStatus: OrchestrateAgentStatus = status,
): OrchestrateAgentStatus {
  if (runStatus === 'error' && liveStatus === 'running') return 'cancelled'
  return liveStatus
}

export function getOrchestrateStats(agents: OrchestrateAgentRun[]): OrchestrateStats {
  const stats: OrchestrateStats = {
    total: agents.length,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  }
  for (const agent of agents) {
    if (agent.status === 'queued') stats.queued++
    else if (agent.status === 'running') stats.running++
    else if (agent.status === 'completed') stats.completed++
    else if (agent.status === 'error') stats.failed++
    else stats.cancelled++
  }
  return stats
}

export function getOrchestrateSessionIds(runs: OrchestrateRun[]): string[] {
  const ids = new Set<string>()
  for (const run of runs) {
    for (const agent of run.agents) {
      if (agent.sessionId) ids.add(agent.sessionId)
    }
  }
  return Array.from(ids)
}
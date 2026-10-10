import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Process } from '../types/api'
import { SessionStatusPanel } from './SessionStatusPanel'

type ProcessChangedSubscriber = { onProcessChanged?: () => void }

const { listProcessesMock, subscribeToEventsMock, processSubscribers } = vi.hoisted(() => ({
  listProcessesMock: vi.fn(),
  subscribeToEventsMock: vi.fn(),
  processSubscribers: [] as ProcessChangedSubscriber[],
}))

vi.mock('../api', () => ({
  getProviderBalance: vi.fn(),
  getSessionTodos: vi.fn().mockResolvedValue([]),
  getSessionWorkBrief: vi.fn().mockResolvedValue({
    confirmedDecisions: [],
    constraints: [],
    acceptanceCriteria: [],
    openQuestions: [],
    relevantEvidence: [],
    closeout: [],
  }),
  listProcesses: (...args: unknown[]) => listProcessesMock(...args),
  subscribeToEvents: (callbacks: ProcessChangedSubscriber) => {
    processSubscribers.push(callbacks)
    return () => {}
  },
}))

vi.mock('../store', () => ({
  todoStore: { setTodos: vi.fn() },
  useTodos: () => [],
  useTodoStats: () => ({ total: 0, completed: 0 }),
}))

vi.mock('../hooks', () => ({
  useModels: () => ({ models: [] }),
}))

vi.mock('../utils/modelUtils', () => ({
  getSessionModelSelection: () => undefined,
  parseModelKey: () => null,
}))

function makeProcess(overrides: Partial<Process>): Process {
  return {
    id: 'process-1',
    sessionID: 'session-1',
    hostBootID: 'boot-1',
    pid: 1000,
    pgid: 1000,
    command: 'sleep 60',
    cwd: '/repo',
    status: 'running',
    exitCode: null,
    startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    exitedAt: null,
    sessionTitle: null,
    agent: null,
    ...overrides,
  }
}

describe('SessionStatusPanel session processes', () => {
  beforeEach(() => {
    listProcessesMock.mockReset()
    subscribeToEventsMock.mockReset()
    processSubscribers.length = 0
  })

  it('shows running processes across sessions with the current session first', async () => {
    // 服务端按 started_at 升序返回；other 更早，仍应排在 current 之后
    listProcessesMock.mockResolvedValue([
      makeProcess({
        id: 'process-0',
        sessionID: 'session-0',
        pid: 900,
        command: 'rg -n pattern src',
        sessionTitle: 'Web research',
        agent: 'explore',
      }),
      makeProcess({
        id: 'process-1',
        sessionID: 'session-1',
        pid: 901,
        command: 'bun test --timeout 30000',
        agent: 'build',
      }),
    ])

    render(<SessionStatusPanel sessionId="session-1" directory="/repo" active />)

    await waitFor(() => expect(screen.getByText('bun test --timeout 30000')).toBeInTheDocument())

    expect(listProcessesMock).toHaveBeenCalledWith('/repo')
    expect(screen.getByText('PID 901')).toBeInTheDocument()
    expect(screen.getByText('this session · build')).toBeInTheDocument()
    expect(screen.getByText('Web research · explore')).toBeInTheDocument()

    const currentRow = screen.getByText('bun test --timeout 30000')
    const otherRow = screen.getByText('rg -n pattern src')
    expect(currentRow.compareDocumentPosition(otherRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('marks cross-session owner with sessionTitle fallback to sessionID', async () => {
    listProcessesMock.mockResolvedValue([
      makeProcess({ id: 'process-0', sessionID: 'session-0', pid: 900, command: 'make build' }),
    ])

    render(<SessionStatusPanel sessionId="session-1" directory="/repo" active />)

    await waitFor(() => expect(screen.getByText('make build')).toBeInTheDocument())
    expect(screen.getByText('session-0')).toBeInTheDocument()
  })

  it('renders loading and empty states', async () => {
    listProcessesMock.mockReturnValue(new Promise<Process[]>(() => {}))

    const { unmount } = render(<SessionStatusPanel sessionId="session-1" directory="/repo" active />)
    await waitFor(() => expect(screen.getByText('Loading processes...')).toBeInTheDocument())
    unmount()

    listProcessesMock.mockResolvedValue([])
    render(<SessionStatusPanel sessionId="session-1" directory="/repo" active />)
    await waitFor(() => expect(screen.getByText('No running processes')).toBeInTheDocument())
  })

  it('refetches the process list when a process.changed event arrives', async () => {
    listProcessesMock.mockResolvedValue([makeProcess({ id: 'process-1', command: 'bun test' })])

    render(<SessionStatusPanel sessionId="session-1" directory="/repo" active />)
    await waitFor(() => expect(screen.getByText('bun test')).toBeInTheDocument())
    expect(listProcessesMock).toHaveBeenCalledTimes(1)

    listProcessesMock.mockResolvedValue([makeProcess({ id: 'process-2', command: 'cargo check' })])
    const trigger = () => {
      for (const subscriber of processSubscribers) subscriber.onProcessChanged?.()
    }

    await act(async () => {
      trigger()
    })

    await waitFor(() => expect(screen.getByText('cargo check')).toBeInTheDocument())
    expect(screen.queryByText('bun test')).not.toBeInTheDocument()
    expect(listProcessesMock).toHaveBeenCalledTimes(2)
  })
})

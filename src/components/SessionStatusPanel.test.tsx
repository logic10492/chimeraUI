import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Process } from '../types/api/process'
import type { WorkBrief } from '../types/api/session'
import { getProviderBalance } from '../api/client'
import { getSessionWorkBrief } from '../api/session'
import { SessionStatusPanel } from './SessionStatusPanel'

type ProcessChangedSubscriber = { onProcessChanged?: () => void }

const { listProcessesMock, subscribeToEventsMock, processSubscribers } = vi.hoisted(() => ({
  listProcessesMock: vi.fn(),
  subscribeToEventsMock: vi.fn(),
  processSubscribers: [] as ProcessChangedSubscriber[],
}))

vi.mock('../api/client', () => ({
  getProviderBalance: vi.fn(),
}))
vi.mock('../api/session', () => ({
  getSessionTodos: vi.fn().mockResolvedValue([]),
  getSessionWorkBrief: vi.fn().mockResolvedValue({
    confirmedDecisions: [],
    constraints: [],
    acceptanceCriteria: [],
    openQuestions: [],
    relevantEvidence: [],
    closeout: [],
  }),
}))
vi.mock('../api/process', () => ({
  listProcesses: (...args: unknown[]) => listProcessesMock(...args),
}))
vi.mock('../api/events', () => ({
  subscribeToEvents: (callbacks: ProcessChangedSubscriber) => {
    processSubscribers.push(callbacks)
    return () => {}
  },
}))

vi.mock('../store/todoStore', () => ({
  todoStore: { setTodos: vi.fn() },
  useTodos: () => [],
  useTodoStats: () => ({ total: 0, completed: 0 }),
}))

vi.mock('../hooks/useModels', () => ({
  useModels: () => ({ models: [] }),
}))

vi.mock('../utils/modelUtils', () => ({
  getSessionModelSelection: () => undefined,
  parseModelKey: () => null,
}))

function emptyWorkBrief(): WorkBrief {
  return {
    confirmedDecisions: [],
    constraints: [],
    acceptanceCriteria: [],
    openQuestions: [],
    relevantEvidence: [],
    closeout: [],
  }
}

beforeEach(() => {
  vi.mocked(getSessionWorkBrief).mockReset().mockResolvedValue(emptyWorkBrief())
  vi.mocked(getProviderBalance).mockReset()
})

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

describe('SessionStatusPanel provider balance visibility', () => {
  beforeEach(() => {
    listProcessesMock.mockResolvedValue([])
  })

  it('hides the whole section for unsupported providers', async () => {
    render(<SessionStatusPanel sessionId="session-1" directory="/repo-balance-1" active providerId="anthropic" />)
    await waitFor(() => expect(screen.getByText('No WorkBrief yet')).toBeInTheDocument())
    expect(screen.queryByText('Provider Balance')).not.toBeInTheDocument()
    expect(getProviderBalance).not.toHaveBeenCalled()
  })

  it('renders the section for openai (Codex)', async () => {
    vi.mocked(getProviderBalance).mockResolvedValue({
      kind: 'quota',
      providerID: 'openai',
      status: 'available',
      limits: [{ label: '5h', used_percent: 20, remaining_percent: 80 }],
    })
    render(<SessionStatusPanel sessionId="session-1" directory="/repo-balance-2" active providerId="openai" />)
    await waitFor(() => expect(screen.getByText('Provider Balance')).toBeInTheDocument())
    expect(await screen.findByText('Codex 80% left')).toBeInTheDocument()
    expect(getProviderBalance).toHaveBeenCalledWith('openai', '/repo-balance-2')
  })

  it('renders the section for deepseek', async () => {
    vi.mocked(getProviderBalance).mockResolvedValue({
      kind: 'billing',
      providerID: 'deepseek',
      status: 'available',
      balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '0', topped_up_balance: '0' }],
    })
    render(<SessionStatusPanel sessionId="session-1" directory="/repo-balance-3" active providerId="deepseek" />)
    await waitFor(() => expect(screen.getByText('Provider Balance')).toBeInTheDocument())
    expect(await screen.findByText('DeepSeek CNY 12.34')).toBeInTheDocument()
  })
})

describe('SessionStatusPanel work brief expansion', () => {
  beforeEach(() => {
    listProcessesMock.mockResolvedValue([])
  })

  it('expands and collapses the full work brief', async () => {
    vi.mocked(getSessionWorkBrief).mockResolvedValue({
      intent: 'Implement the complete intent description without truncation',
      confirmedDecisions: ['decision-A'],
      constraints: ['constraint-A'],
      acceptanceCriteria: [],
      openQuestions: [],
      relevantEvidence: [],
      closeout: [],
    })

    render(<SessionStatusPanel sessionId="session-1" directory="/repo-brief-1" active />)

    const toggle = await screen.findByRole('button', { name: 'Expand work brief' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/constraint-A/)).not.toBeInTheDocument()
    expect(screen.queryByText(/decision-A/)).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(await screen.findByText(/constraint-A/)).toBeInTheDocument()
    expect(screen.getByText(/decision-A/)).toBeInTheDocument()
    expect(screen.getByText('Implement the complete intent description without truncation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse work brief' })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse work brief' }))
    await waitFor(() => expect(screen.queryByText(/constraint-A/)).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Expand work brief' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not render the toggle when the work brief is unavailable', async () => {
    vi.mocked(getSessionWorkBrief).mockRejectedValue(new Error('no brief'))

    render(<SessionStatusPanel sessionId="session-1" directory="/repo-brief-2" active />)

    await waitFor(() => expect(screen.getByText('No WorkBrief yet')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /work brief/i })).not.toBeInTheDocument()
  })
})

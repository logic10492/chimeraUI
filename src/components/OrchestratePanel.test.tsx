import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../types/message'
import { OrchestratePanel } from './OrchestratePanel'

const { abortSessionMock, inlineRequestsMock, navigateToSessionMock, getSessionInfoMock, stateMock } = vi.hoisted(() => ({
  abortSessionMock: vi.fn(),
  inlineRequestsMock: vi.fn(),
  navigateToSessionMock: vi.fn(),
  getSessionInfoMock: vi.fn(),
  stateMock: { messages: [] as Message[], hasMoreHistory: false },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./Icons', () => ({
  ExternalLinkIcon: () => <span />,
  StopIcon: () => <span />,
}))

vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="orchestrate-output">{content}</div>,
}))

vi.mock('../contexts/SessionNavigationContext', () => ({
  useSessionNavigation: () => ({
    currentSessionId: 'parent',
    currentDirectory: '/repo',
    navigateToSession: navigateToSessionMock,
  }),
}))

vi.mock('../api/session', () => ({
  abortSession: abortSessionMock,
}))

vi.mock('../store/childSessionStore', () => ({
  childSessionStore: {
    getSessionInfo: getSessionInfoMock,
    isChildOf: () => false,
    subscribe: () => () => {},
  },
}))

vi.mock('../store/messageStore', () => ({
  messageStore: {
    getSessionState: () => ({ isStreaming: false }),
    subscribe: () => () => {},
  },
}))

vi.mock('../store/messageStoreHooks', () => ({
  useSessionState: () => stateMock,
}))

vi.mock('../features/chat/InlineToolRequestContext', () => ({
  useInlineToolRequests: () => inlineRequestsMock(),
}))

vi.mock('../features/chat/InteractionCard', () => ({
  InteractionCard: () => null,
}))

beforeEach(() => {
  vi.clearAllMocks()
  stateMock.messages = []
  stateMock.hasMoreHistory = false
  getSessionInfoMock.mockReturnValue(undefined)
  inlineRequestsMock.mockReturnValue({
    pendingPermissions: [],
    pendingQuestions: [],
    onPermissionReply: vi.fn(),
    onQuestionReply: vi.fn(),
    onQuestionReject: vi.fn(),
    isReplying: false,
  })
})

function createOrchestrateMessage(agents: Record<string, unknown>[], status: 'running' | 'completed' | 'error' = 'running') {
  return {
    info: { id: 'message-1' } as Message['info'],
    parts: [
      {
        id: 'orchestrate-tool',
        sessionID: 'parent',
        messageID: 'message-1',
        type: 'tool' as const,
        callID: 'call-1',
        tool: 'orchestrate',
        state: {
          status,
          input: { code: 'await orche.parallel([])' },
          title: 'Review batch',
          output: '## Result\nall good',
          metadata: { agents },
        },
      },
    ],
  } satisfies Message
}

describe('OrchestratePanel', () => {
  it('renders an empty state when the session has no orchestrate runs', () => {
    render(<OrchestratePanel sessionId="parent" directory="/repo" active />)
    expect(screen.getByText('orchestratePanel.empty')).toBeInTheDocument()
  })

  it('renders a no-session state without a session id', () => {
    render(<OrchestratePanel sessionId={null} directory="/repo" active />)
    expect(screen.getByText('orchestratePanel.noSession')).toBeInTheDocument()
  })

  it('derives a live completed status for a running agent from the child session store', () => {
    getSessionInfoMock.mockReturnValue({ parentID: 'parent', status: 'idle' })
    stateMock.messages = [
      createOrchestrateMessage([{ label: 'Review child', agent: 'reviewer', sessionId: 'child-1', status: 'running' }]),
    ]

    render(<OrchestratePanel sessionId="parent" directory="/repo" active />)

    const agent = document.querySelector('[data-agent-index="1"]') as HTMLElement
    expect(agent.dataset.status).toBe('completed')
    expect(screen.queryByLabelText('orchestratePanel.stop')).not.toBeInTheDocument()
  })

  it('maps failed agents to error even if the live child status is running', () => {
    getSessionInfoMock.mockReturnValue({ parentID: 'parent', status: 'running' })
    stateMock.messages = [
      createOrchestrateMessage([{ label: 'Broken child', agent: 'general', sessionId: 'child-1', status: 'failed' }]),
    ]

    render(<OrchestratePanel sessionId="parent" directory="/repo" active />)

    const agent = document.querySelector('[data-agent-index="1"]') as HTMLElement
    expect(agent.dataset.status).toBe('error')
  })

  it('treats a still-running agent as cancelled once the orchestrate part errored', () => {
    getSessionInfoMock.mockReturnValue({ parentID: 'parent', status: 'running' })
    stateMock.messages = [
      createOrchestrateMessage([{ label: 'Zombie child', agent: 'general', sessionId: 'child-1', status: 'running' }], 'error'),
    ]

    render(<OrchestratePanel sessionId="parent" directory="/repo" active />)

    const agent = document.querySelector('[data-agent-index="1"]') as HTMLElement
    expect(agent.dataset.status).toBe('cancelled')
  })

  it('navigates to the child session when an agent row is clicked', () => {
    stateMock.messages = [
      createOrchestrateMessage([{ label: 'Review child', agent: 'reviewer', sessionId: 'child-1', status: 'running' }]),
    ]

    render(<OrchestratePanel sessionId="parent" directory="/repo" active />)

    fireEvent.click(screen.getByText('Review child'))
    expect(navigateToSessionMock).toHaveBeenCalledWith('child-1', '/repo')
  })

  it('aborts a running child session from the stop button', () => {
    stateMock.messages = [
      createOrchestrateMessage([{ label: 'Review child', agent: 'reviewer', sessionId: 'child-1', status: 'running' }]),
    ]

    render(<OrchestratePanel sessionId="parent" directory="/repo" active />)

    fireEvent.click(screen.getByLabelText('orchestratePanel.stop'))
    expect(abortSessionMock).toHaveBeenCalledWith('child-1', '/repo')
  })

  it('shows the loaded-history hint when more history exists', () => {
    stateMock.hasMoreHistory = true
    stateMock.messages = [
      createOrchestrateMessage([{ label: 'Review child', agent: 'reviewer', sessionId: 'child-1', status: 'running' }]),
    ]

    render(<OrchestratePanel sessionId="parent" directory="/repo" active />)

    expect(screen.getByText('orchestratePanel.onlyLoadedHistory')).toBeInTheDocument()
  })
})
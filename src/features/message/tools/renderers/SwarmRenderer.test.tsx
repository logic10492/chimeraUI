import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolPart } from '../../../../types/message'
import { SwarmRenderer, getSwarmChildRuns } from './SwarmRenderer'

const { abortSessionMock, inlineRequestsMock, navigateToSessionMock, getSessionInfoMock, capabilitiesMock } = vi.hoisted(() => ({
  abortSessionMock: vi.fn(),
  inlineRequestsMock: vi.fn(),
  navigateToSessionMock: vi.fn(),
  getSessionInfoMock: vi.fn(),
  capabilitiesMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../../../components/Icons', () => ({
  ChevronRightIcon: () => <span />,
  ExternalLinkIcon: () => <span />,
  StopIcon: () => <span />,
}))

vi.mock('../../../../contexts/SessionNavigationContext', () => ({
  useSessionNavigation: () => ({
    currentSessionId: 'parent',
    currentDirectory: '/repo',
    navigateToSession: navigateToSessionMock,
  }),
}))

vi.mock('../../../../api/session', () => ({
  abortSession: abortSessionMock,
}))

vi.mock('../../../../store/childSessionStore', () => ({
  childSessionStore: {
    getSessionInfo: getSessionInfoMock,
    isChildOf: () => false,
    subscribe: () => () => {},
  },
}))
vi.mock('../../../../store/messageStore', () => ({
  messageStore: {
    getSessionState: () => ({ directory: '/repo' }),
    subscribe: () => () => {},
  },
}))

vi.mock('../../../../hooks/useServerCapabilities', () => ({
  useServerCapabilities: () => capabilitiesMock(),
}))

vi.mock('../../../chat/InlineToolRequestContext', () => ({
  useInlineToolRequests: () => inlineRequestsMock(),
}))

vi.mock('../../../chat/InteractionCard', () => ({
  InteractionCard: ({ permission, question }: { permission?: { id: string }; question?: { id: string } }) =>
    permission ? <div data-testid={`permission-${permission.id}`} /> : question ? <div data-testid={`question-${question.id}`} /> : null,
}))

vi.mock('./TaskRenderer', () => ({
  SubSessionView: ({ sessionId }: { sessionId: string }) => <div data-testid={`session-${sessionId}`} />,
}))

beforeEach(() => {
  vi.clearAllMocks()
  getSessionInfoMock.mockReturnValue({ parentID: 'parent' })
  capabilitiesMock.mockReturnValue({ backgroundSubagents: true })
  inlineRequestsMock.mockReturnValue({
    pendingPermissions: [],
    pendingQuestions: [],
    onPermissionReply: vi.fn(),
    onQuestionReply: vi.fn(),
    onQuestionReject: vi.fn(),
    isReplying: false,
  })
})

function createPart(): ToolPart {
  return {
    id: 'swarm-tool',
    sessionID: 'parent',
    messageID: 'message',
    type: 'tool',
    callID: 'swarm-call',
    tool: 'chimera_swarm',
    state: {
      status: 'running',
      input: {},
      metadata: {
        childRuns: [
          { index: 2, title: 'Second', subagentType: 'review', status: 'running', sessionId: 'child-2' },
          { index: 1, title: 'First', subagentType: 'general', status: 'running', sessionId: 'child-1' },
        ],
      },
    },
  }
}

describe('getSwarmChildRuns', () => {
  it('sorts childRuns by index and preserves their session mapping', () => {
    expect(
      getSwarmChildRuns({
        childRuns: [
          { index: 3, title: 'Third', subagentType: 'general', status: 'error', sessionId: 'session-3' },
          { index: 1, title: 'First', subagentType: 'review', status: 'completed', sessionId: 'session-1' },
        ],
      }),
    ).toEqual([
      { index: 1, title: 'First', subagentType: 'review', status: 'completed', sessionId: 'session-1', error: undefined },
      { index: 3, title: 'Third', subagentType: 'general', status: 'error', sessionId: 'session-3', error: undefined },
    ])
  })

  it('maps legacy childSessions without guessing a shared child', () => {
    expect(getSwarmChildRuns({ childSessions: ['session-a', 'session-b'] })).toEqual([
      { index: 1, title: 'Child 1', subagentType: 'general', status: 'completed', sessionId: 'session-a' },
      { index: 2, title: 'Child 2', subagentType: 'general', status: 'completed', sessionId: 'session-b' },
    ])
  })

  it('merges compatibility child sessions and results while normalizing legacy fields', () => {
    expect(
      getSwarmChildRuns(
        {
          childSessions: [
            'session-1',
            { index: 2, title: 'Second', subagent_type: 'review', sessionId: 'session-2' },
          ],
          results: [
            { index: 1, title: 'First', status: 'success', sessionId: 'session-1' },
            { index: 2, status: 'failure', error: 'boom' },
          ],
        },
        'completed',
      ),
    ).toEqual([
      { index: 1, title: 'First', subagentType: 'general', status: 'completed', sessionId: 'session-1', error: undefined },
      { index: 2, title: 'Second', subagentType: 'review', status: 'error', sessionId: 'session-2', error: 'boom' },
    ])
  })

  it('treats legacy child sessions as running while the parent swarm is running', () => {
    expect(getSwarmChildRuns({ childSessions: ['session-a'] }, 'running')[0]?.status).toBe('running')
  })
})

describe('SwarmRenderer child request routing', () => {
  it('keeps permission and question requests attached to their exact child sessions', () => {
    inlineRequestsMock.mockReturnValue({
      pendingPermissions: [{ id: 'permission-1', sessionID: 'child-1' }],
      pendingQuestions: [{ id: 'question-2', sessionID: 'child-2' }],
      onPermissionReply: vi.fn(),
      onQuestionReply: vi.fn(),
      onQuestionReject: vi.fn(),
      isReplying: false,
    })

    render(<SwarmRenderer part={createPart()} data={{}} />)

    const first = document.querySelector('[data-child-index="1"]')
    const second = document.querySelector('[data-child-index="2"]')
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(within(first as HTMLElement).getByTestId('session-child-1')).toBeInTheDocument()
    expect(within(first as HTMLElement).getByTestId('permission-permission-1')).toBeInTheDocument()
    expect(within(first as HTMLElement).queryByTestId('question-question-2')).not.toBeInTheDocument()
    expect(within(second as HTMLElement).getByTestId('session-child-2')).toBeInTheDocument()
    expect(within(second as HTMLElement).getByTestId('question-question-2')).toBeInTheDocument()
    expect(within(second as HTMLElement).queryByTestId('permission-permission-1')).not.toBeInTheDocument()
    expect(screen.getAllByText('running')).toHaveLength(2)
  })

  it('stops or opens only the selected child session', () => {
    render(<SwarmRenderer part={createPart()} data={{}} />)

    fireEvent.click(screen.getAllByLabelText('task.stop')[0])
    expect(abortSessionMock).toHaveBeenCalledWith('child-1', '/repo')

    fireEvent.click(screen.getAllByLabelText('task.openSession')[1])
    expect(navigateToSessionMock).toHaveBeenCalledWith('child-2', '/repo')
  })
})

function createBackgroundPart(childRuns: Record<string, unknown>[]): ToolPart {
  const part = createPart()
  return {
    ...part,
    state: { ...part.state, status: 'completed', metadata: { background: true, childRuns } },
  }
}

describe('SwarmRenderer background swarm', () => {
  it('derives live child status from the child session store instead of the frozen receipt', () => {
    getSessionInfoMock.mockImplementation((sessionId: string) =>
      sessionId === 'child-1'
        ? { parentID: 'parent', status: 'idle' }
        : { parentID: 'parent', status: 'running' },
    )

    render(
      <SwarmRenderer
        part={createBackgroundPart([
          { index: 1, title: 'Frozen running', subagentType: 'general', status: 'running', sessionId: 'child-1' },
          { index: 2, title: 'Still running', subagentType: 'general', status: 'running', sessionId: 'child-2' },
        ])}
        data={{}}
      />,
    )

    const first = document.querySelector('[data-child-index="1"]') as HTMLElement
    const second = document.querySelector('[data-child-index="2"]') as HTMLElement
    expect(within(first).getByText('completed')).toBeInTheDocument()
    expect(within(first).queryByText('running')).not.toBeInTheDocument()
    expect(within(first).queryByLabelText('task.stop')).not.toBeInTheDocument()
    expect(within(second).getByText('running')).toBeInTheDocument()
    expect(within(second).getByLabelText('task.stop')).toBeInTheDocument()
  })

  it('shows queued for background children without a session id', () => {
    render(
      <SwarmRenderer
        part={createBackgroundPart([
          { index: 1, title: 'Queued', subagentType: 'general', status: 'running' },
        ])}
        data={{}}
      />,
    )

    const child = document.querySelector('[data-child-index="1"]') as HTMLElement
    expect(within(child).getByText('queued')).toBeInTheDocument()
    expect(within(child).queryByText('running')).not.toBeInTheDocument()
  })

  it('renders the background badge for background receipts', () => {
    render(
      <SwarmRenderer
        part={createBackgroundPart([
          { index: 1, title: 'Child', subagentType: 'general', status: 'running', sessionId: 'child-1' },
        ])}
        data={{}}
      />,
    )

    expect(screen.getByText('task.background')).toBeInTheDocument()
  })

  it('never normalizes an unknown background status to completed', () => {
    expect(getSwarmChildRuns({ background: true, childRuns: [{ index: 1, title: 'No session' }] })[0]?.status).toBe(
      'queued',
    )
    expect(
      getSwarmChildRuns({ background: true, childRuns: [{ index: 1, title: 'Has session', sessionId: 'session-1' }] })[0]
        ?.status,
    ).toBe('running')
  })
})

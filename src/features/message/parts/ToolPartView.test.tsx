import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolPartView } from './ToolPartView'
import type { FilePart, ToolPart } from '../../../types/message'

const { getActiveCalibratedNowMock, getPartOutputMock } = vi.hoisted(() => ({
  getActiveCalibratedNowMock: vi.fn<() => number | undefined>(() => undefined),
  getPartOutputMock: vi.fn<() => Promise<{ output?: string; attachments?: unknown } | null>>(async () => null),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'toolPart.running') return 'Running'
      if (key === 'toolPart.failed') return 'Failed'
      return key
    },
  }),
}))

vi.mock('../../../hooks/useDelayedRender', () => ({
  useDelayedRender: (show: boolean) => show,
}))
vi.mock('../../../hooks/useDisclosureScrollLock', () => ({
  useDisclosureScrollLock: () => ({
    rootRef: () => undefined,
    headerRef: () => undefined,
    withScrollLock: (action: () => void) => action(),
  }),
}))

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({
    inlineToolRequests: false,
    immersiveMode: false,
    compactInlinePermission: false,
  }),
}))

vi.mock('../../../store/serverStore', () => ({
  serverStore: {
    getActiveCalibratedNow: getActiveCalibratedNowMock,
    getActiveServerId: () => 'local',
    onServerChange: () => () => {},
  },
}))

vi.mock('../../../api/message', () => ({
  getPartOutput: getPartOutputMock,
}))

vi.mock('../../../store/messageStore', () => ({
  messageStore: {
    getSessionDirectory: () => undefined,
  },
}))

vi.mock('../../attachment/AttachmentDetailModal', () => ({
  AttachmentDetailModal: () => null,
}))

vi.mock('../../chat/InlineToolRequestContext', () => ({
  useInlineToolRequests: () => ({
    pendingPermissions: [],
    pendingQuestions: [],
    onPermissionReply: vi.fn(),
    onQuestionReply: vi.fn(),
    onQuestionReject: vi.fn(),
    isReplying: false,
  }),
  findPermissionRequestForTool: () => undefined,
  findQuestionRequestForTool: () => undefined,
}))

vi.mock('../../chat/InteractionCard', () => ({
  InteractionCard: () => null,
}))

vi.mock('../tools/registry', () => ({
  getToolIcon: () => <span data-testid="tool-icon">icon</span>,
  extractToolData: () => ({}),
  getToolConfig: () => undefined,
}))
vi.mock('../tools/renderers/DefaultRenderer', () => ({
  DefaultRenderer: () => null,
}))
vi.mock('../tools/renderers/TodoRenderer', () => ({
  TodoRenderer: () => null,
}))
vi.mock('../tools/renderers/TaskRenderer', () => ({
  TaskRenderer: () => null,
}))
vi.mock('../tools/renderers/todoUtils', () => ({
  hasTodos: () => false,
}))

function createRunningToolPart(): ToolPart {
  return {
    id: 'tool-1',
    sessionID: 'session-1',
    messageID: 'message-1',
    type: 'tool',
    callID: 'call-1',
    tool: 'bash',
    state: {
      status: 'running',
      title: 'npm run build',
      time: { start: 7_500 },
    },
  }
}

describe('ToolPartView running duration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    getActiveCalibratedNowMock.mockReset()
    getActiveCalibratedNowMock.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('falls back to local wall clock when calibration is unavailable', () => {
    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('2.5s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByText('3.0s')).toBeInTheDocument()
  })

  it('uses calibrated server time for running tools when available', () => {
    getActiveCalibratedNowMock.mockReturnValue(11_000)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('3.5s')).toBeInTheDocument()
  })

  it('clamps running duration to zero when calibrated time is earlier than start', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_000)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('0ms')).toBeInTheDocument()
  })

  it('rounds calibrated sub-second durations before rendering', () => {
    getActiveCalibratedNowMock.mockReturnValue(7_623.456)

    render(<ToolPartView part={createRunningToolPart()} />)

    expect(screen.getByText('123ms')).toBeInTheDocument()
  })
})

function createFileAttachment(overrides: Partial<FilePart> = {}): FilePart {
  return {
    id: 'file-1',
    sessionID: 'session-1',
    messageID: 'msg-att',
    type: 'file',
    mime: 'image/png',
    url: 'data:image/png;base64,AAAA',
    ...overrides,
  }
}

function createCompletedToolPart(id: string, attachments?: FilePart[], stateOverrides: Record<string, unknown> = {}): ToolPart {
  return {
    id,
    sessionID: 'session-1',
    messageID: 'msg-att',
    type: 'tool',
    callID: `call-${id}`,
    tool: 'browser_screenshot',
    state: {
      status: 'completed',
      input: {},
      output: 'done',
      title: 'Screenshot',
      metadata: {},
      time: { start: 1_000, end: 2_000 },
      attachments,
      ...stateOverrides,
    },
  }
}

function expandBody(title = 'Screenshot') {
  fireEvent.click(screen.getByText(title))
}

describe('ToolPartView attachments', () => {
  beforeEach(() => {
    getPartOutputMock.mockReset()
    getPartOutputMock.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders an img thumbnail for image attachments', () => {
    render(<ToolPartView part={createCompletedToolPart('tool-att-img', [createFileAttachment()])} />)

    expandBody()

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    expect(screen.getByTestId('tool-attachments')).toBeInTheDocument()
  })

  it('renders a file chip with filename and mime for non-image attachments', () => {
    render(
      <ToolPartView
        part={createCompletedToolPart('tool-att-file', [
          createFileAttachment({ id: 'file-2', mime: 'application/pdf', url: 'https://example.com/report.pdf', filename: 'report.pdf' }),
        ])}
      />,
    )

    expandBody()

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('application/pdf')).toBeInTheDocument()
  })

  it('does not render the attachment section when there are no attachments', () => {
    render(<ToolPartView part={createCompletedToolPart('tool-att-none')} />)

    expandBody()

    expect(screen.queryByTestId('tool-attachments')).not.toBeInTheDocument()
  })

  it('renders lazily loaded attachments after fetching truncated output', async () => {
    getPartOutputMock.mockResolvedValue({
      output: 'full output',
      attachments: [createFileAttachment({ id: 'file-lazy', url: 'data:image/png;base64,LAZY' })],
    })
    render(
      <ToolPartView
        part={createCompletedToolPart('tool-att-lazy', undefined, { outputTruncated: true, outputSize: 2048 })}
      />,
    )

    expandBody()
    expect(screen.queryByTestId('tool-attachments')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText(/^Show output/))
    })

    const img = await screen.findByRole('img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,LAZY')
  })
})

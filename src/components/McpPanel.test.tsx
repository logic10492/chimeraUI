import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpPanel } from './McpPanel'

const getMcpStatusMock = vi.fn()
const getMcpResourcesMock = vi.fn()

vi.mock('../api/mcp', () => ({
  getMcpStatus: (...args: unknown[]) => getMcpStatusMock(...args),
  getMcpResources: (...args: unknown[]) => getMcpResourcesMock(...args),
  connectMcpServer: vi.fn(),
  disconnectMcpServer: vi.fn(),
  startMcpAuth: vi.fn(),
  authenticateMcp: vi.fn(),
  addMcpServer: vi.fn(),
}))

vi.mock('../contexts/useDirectory', () => ({
  useDirectory: () => ({ currentDirectory: '/workspace/demo' }),
}))

vi.mock('../utils', () => ({
  apiErrorHandler: vi.fn(),
}))

vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('McpPanel statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMcpResourcesMock.mockResolvedValue({})
  })

  it('renders connecting as an in-progress state without server actions', async () => {
    getMcpStatusMock.mockResolvedValue({
      booting: { status: 'connecting' },
      ready: { status: 'connected' },
      off: { status: 'disabled' },
      broken: { status: 'failed', error: 'boom' },
    })

    render(<McpPanel />)

    await waitFor(() => expect(screen.getByText('Connecting...')).toBeInTheDocument())

    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()

    // Only the settled states expose actions: connected -> disconnect,
    // failed/disabled -> connect. A connecting server offers no action.
    expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Authenticate' })).not.toBeInTheDocument()
  })

  it('polls while a server is connecting and stops once it settles', async () => {
    vi.useFakeTimers()
    getMcpStatusMock
      .mockResolvedValueOnce({ booting: { status: 'connecting' } })
      .mockResolvedValue({ booting: { status: 'connected' } })

    render(<McpPanel />)

    await act(async () => {})
    expect(getMcpStatusMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Connecting...')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(getMcpStatusMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Connected')).toBeInTheDocument()

    // Settled: no further polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(getMcpStatusMock).toHaveBeenCalledTimes(2)
  })

  it('stops polling when the panel unmounts', async () => {
    vi.useFakeTimers()
    getMcpStatusMock.mockResolvedValue({ booting: { status: 'connecting' } })

    const { unmount } = render(<McpPanel />)

    await act(async () => {})
    expect(getMcpStatusMock).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(getMcpStatusMock).toHaveBeenCalledTimes(1)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})
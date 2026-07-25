import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteCompactionEligibilityList, RemoteCompactionResolution } from '@opencode-ai/sdk/v2'
import { CompactionSettings } from './CompactionSettings'

const {
  getEligibilityMock,
  getStatusMock,
  updateEligibilityMock,
  updatePolicyMock,
  usePaneControllerMock,
  usePaneLayoutMock,
} = vi.hoisted(() => ({
  getEligibilityMock: vi.fn(),
  getStatusMock: vi.fn(),
  updateEligibilityMock: vi.fn(),
  updatePolicyMock: vi.fn(),
  usePaneControllerMock: vi.fn(),
  usePaneLayoutMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (typeof values?.error === 'string') return `${key}: ${values.error}`
      if (typeof values?.identity === 'string') return `${key}: ${values.identity}`
      return key
    },
  }),
}))

vi.mock('../../../api/config', () => ({
  getRemoteCompactionEligibility: getEligibilityMock,
  getRemoteCompactionStatus: getStatusMock,
  updateRemoteCompactionEligibility: updateEligibilityMock,
  updateRemoteCompactionPolicy: updatePolicyMock,
}))

vi.mock('../../../store/paneControllerStore', () => ({ usePaneController: usePaneControllerMock }))
vi.mock('../../../store/paneLayoutStore', () => ({ usePaneLayout: usePaneLayoutMock }))

const eligibility = list([
  item('focused-provider', 'focused-model', { configurable: true, enabled: 'disabled' }),
  item('other-provider', 'other-model', { configurable: true, enabled: 'disabled' }),
])
let activeController = controller('/focused/directory')

function statusFor(providerID: string, modelID: string): RemoteCompactionResolution {
  return {
    configured: { mode: 'auto', protocol: 'v2' },
    requested: { providerID, modelID },
    effective: { providerID, modelID, wireModelID: `wire-${modelID}` },
    mode: 'remote',
    target: 'provider',
    credential: 'provider-bearer',
    protocols: ['v2', 'legacy'],
    localFallback: true,
    reason: 'ready',
    lock: { status: 'none' },
    replay: { mode: 'none', reason: 'no_lock' },
  }
}

function item(
  providerID: string,
  modelID: string,
  options: { configurable: boolean; enabled: 'enabled' | 'disabled' | 'unset'; wireApi?: 'chat' | 'responses' } = {
    configurable: true,
    enabled: 'disabled',
  },
) {
  return {
    providerID,
    providerName: `${providerID} name`,
    modelID,
    modelName: `${modelID} name`,
    apiNpm: '@ai-sdk/openai-compatible',
    wire_api: options.wireApi ?? 'responses',
    providerCapability: { present: true, protocols: ['v2', 'legacy'] as ('v2' | 'legacy')[] },
    modelRemoteCompaction: options.enabled,
    configurable: options.configurable,
  }
}

function list(items: ReturnType<typeof item>[]): RemoteCompactionEligibilityList {
  return { items }
}

function controller(
  directory: string,
  overrides: Partial<{
    currentProviderId: string | undefined
    currentModelId: string | undefined
    sessionId: string | null
  }> = {},
) {
  return {
    currentProviderId: 'focused-provider',
    currentModelId: 'focused-model',
    sessionId: 'focused-session',
    effectiveDirectory: directory,
    ...overrides,
  }
}

function renderSettings() {
  const view = render(<CompactionSettings />)
  return { ...view, provider: () => screen.getByRole('combobox', { name: 'compaction.provider' }) }
}

function statusCall(providerID: string, modelID: string, directory: string, sessionID?: string) {
  return {
    args: [{ providerID, modelID, ...(sessionID ? { sessionID } : {}) }, directory],
  }
}

describe('CompactionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeController = controller('/focused/directory')
    usePaneLayoutMock.mockReturnValue({ focusedPaneId: 'focused-pane' })
    usePaneControllerMock.mockImplementation(() => activeController)
    getEligibilityMock.mockResolvedValue(eligibility)
    getStatusMock.mockImplementation(({ providerID, modelID }: { providerID: string; modelID: string }) =>
      Promise.resolve(statusFor(providerID, modelID)),
    )
    updateEligibilityMock.mockResolvedValue(eligibility.items[0])
    updatePolicyMock.mockResolvedValue({ remote: 'on', remote_protocol: 'v2' })
  })

  it('loads project eligibility and initializes from the focused model with session-aware status', async () => {
    const view = renderSettings()

    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))
    expect(screen.getByRole('combobox', { name: 'compaction.model' })).toHaveValue('focused-model')
    expect(getEligibilityMock).toHaveBeenCalledWith('/focused/directory')
    await waitFor(() =>
      expect(getStatusMock).toHaveBeenCalledWith(
        ...statusCall('focused-provider', 'focused-model', '/focused/directory', 'focused-session').args,
      ),
    )
  })

  it('shows persistent Responses, disable, and endpoint compatibility guidance', async () => {
    const view = renderSettings()
    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))

    expect(screen.getByText('compaction.enableBehavior')).toBeInTheDocument()
    expect(screen.getByText('compaction.disableBehavior')).toBeInTheDocument()
    expect(screen.getByText('compaction.endpointWarning')).toBeInTheDocument()
    expect(screen.getByText('compaction.ordinaryWireApi')).toBeInTheDocument()
  })

  it('does not render A status for B and shows B status errors with retry', async () => {
    const other = Promise.withResolvers<RemoteCompactionResolution>()
    getStatusMock.mockImplementation(({ providerID, modelID }: { providerID: string; modelID: string }) => {
      if (providerID === 'other-provider') return other.promise
      return Promise.resolve(statusFor(providerID, modelID))
    })
    const view = renderSettings()
    await waitFor(() => expect(screen.getByText('focused-provider/focused-model')).toBeInTheDocument())

    fireEvent.change(view.provider(), { target: { value: 'other-provider' } })
    expect(screen.queryByText('focused-provider/focused-model')).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('compaction.loading')

    await act(() => other.reject(new Error('B unavailable')))
    expect(await screen.findByRole('alert')).toHaveTextContent('compaction.loadError: B unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'compaction.retry' }))
    await waitFor(() =>
      expect(getStatusMock).toHaveBeenCalledWith(
        ...statusCall('other-provider', 'other-model', '/focused/directory').args,
      ),
    )
  })

  it('refreshes only the latest B selection after a deferred policy update started on A', async () => {
    const policy = Promise.withResolvers<{ remote: 'on'; remote_protocol: 'v2' }>()
    updatePolicyMock.mockReturnValue(policy.promise)
    const view = renderSettings()
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'compaction.configuredPolicy' })).toBeInTheDocument(),
    )
    getStatusMock.mockClear()

    fireEvent.change(screen.getByRole('combobox', { name: 'compaction.configuredPolicy' }), { target: { value: 'on' } })
    fireEvent.change(view.provider(), { target: { value: 'other-provider' } })
    await waitFor(() =>
      expect(getStatusMock).toHaveBeenCalledWith(
        ...statusCall('other-provider', 'other-model', '/focused/directory').args,
      ),
    )
    getStatusMock.mockClear()

    await act(() => policy.resolve({ remote: 'on', remote_protocol: 'v2' }))
    await waitFor(() =>
      expect(getStatusMock).toHaveBeenCalledWith(
        ...statusCall('other-provider', 'other-model', '/focused/directory').args,
      ),
    )
    expect(getStatusMock).not.toHaveBeenCalledWith(
      ...statusCall('focused-provider', 'focused-model', '/focused/directory', 'focused-session').args,
    )
  })

  it('ignores out-of-order directory eligibility results and writes eligibility in the current directory', async () => {
    const first = Promise.withResolvers<RemoteCompactionEligibilityList>()
    const second = Promise.withResolvers<RemoteCompactionEligibilityList>()
    getEligibilityMock.mockImplementation((directory: string) =>
      directory === '/project-a' ? first.promise : second.promise,
    )
    activeController = controller('/project-a')
    const view = renderSettings()
    await act(() => {
      activeController = controller('/project-b')
      view.rerender(<CompactionSettings />)
    })

    await act(() => second.resolve(list([item('provider-b', 'model-b', { configurable: true, enabled: 'disabled' })])))
    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))
    fireEvent.change(view.provider(), { target: { value: 'provider-b' } })
    await waitFor(() => expect(view.provider()).toHaveValue('provider-b'))
    await act(() => first.reject(new Error('stale A error')))
    expect(screen.queryByText('compaction.eligibilityLoadError: stale A error')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'compaction.enableEligibility' }))
    await waitFor(() =>
      expect(updateEligibilityMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerID: 'provider-b', modelID: 'model-b', enabled: true }),
        '/project-b',
      ),
    )
  })

  it('ignores a stale successful eligibility response from the previous directory', async () => {
    const first = Promise.withResolvers<RemoteCompactionEligibilityList>()
    const second = Promise.withResolvers<RemoteCompactionEligibilityList>()
    getEligibilityMock.mockImplementation((directory: string) =>
      directory === '/project-a' ? first.promise : second.promise,
    )
    activeController = controller('/project-a')
    const view = renderSettings()
    await act(() => {
      activeController = controller('/project-b')
      view.rerender(<CompactionSettings />)
    })

    await act(() => second.resolve(list([item('provider-b', 'model-b')])))
    await waitFor(() => expect(screen.getByRole('option', { name: /provider-b/ })).toBeInTheDocument())
    await act(() => first.resolve(list([item('provider-a', 'model-a')])))

    expect(screen.queryByRole('option', { name: /provider-a/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /provider-b/ })).toBeInTheDocument()
  })

  it('keeps a focused non-configurable model selected and session-aware', async () => {
    getEligibilityMock.mockResolvedValue(
      list([
        item('focused-provider', 'focused-model', { configurable: false, enabled: 'unset', wireApi: 'chat' }),
        item('other-provider', 'other-model', { configurable: true, enabled: 'disabled' }),
      ]),
    )
    renderSettings()

    expect(await screen.findByRole('switch', { name: 'compaction.enableEligibility' })).toBeDisabled()
    expect(screen.getByText('compaction.notConfigurable')).toBeInTheDocument()
    await waitFor(() =>
      expect(getStatusMock).toHaveBeenCalledWith(
        ...statusCall('focused-provider', 'focused-model', '/focused/directory', 'focused-session').args,
      ),
    )
  })

  it('keeps an absent focused identity session-aware, omits the session for third-party selection, and restores it on return', async () => {
    getEligibilityMock.mockResolvedValue(
      list([item('other-provider', 'other-model', { configurable: true, enabled: 'disabled' })]),
    )
    const view = renderSettings()

    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))
    expect(screen.getByText('compaction.eligibilityUnavailable')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'compaction.enableEligibility' })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(getStatusMock).toHaveBeenCalledWith(
        ...statusCall('focused-provider', 'focused-model', '/focused/directory', 'focused-session').args,
      ),
    )

    fireEvent.change(view.provider(), { target: { value: 'other-provider' } })
    await waitFor(() =>
      expect(getStatusMock).toHaveBeenCalledWith(
        ...statusCall('other-provider', 'other-model', '/focused/directory').args,
      ),
    )

    fireEvent.change(view.provider(), { target: { value: 'focused-provider' } })
    await waitFor(() =>
      expect(getStatusMock).toHaveBeenCalledWith(
        ...statusCall('focused-provider', 'focused-model', '/focused/directory', 'focused-session').args,
      ),
    )
  })

  it('enables with protocols', async () => {
    const view = renderSettings()
    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))
    fireEvent.change(screen.getByRole('combobox', { name: 'compaction.eligibilityProtocols' }), {
      target: { value: 'legacy,v2' },
    })
    fireEvent.click(screen.getByRole('switch', { name: 'compaction.enableEligibility' }))
    await waitFor(() =>
      expect(updateEligibilityMock).toHaveBeenCalledWith(
        {
          providerID: 'focused-provider',
          modelID: 'focused-model',
          enabled: true,
          protocols: ['legacy', 'v2'],
        },
        '/focused/directory',
      ),
    )
  })

  it('disables without transmitting protocols', async () => {
    getEligibilityMock.mockResolvedValue(
      list([item('focused-provider', 'focused-model', { configurable: true, enabled: 'enabled' })]),
    )
    const view = renderSettings()
    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))
    fireEvent.click(screen.getByRole('switch', { name: 'compaction.enableEligibility' }))
    await waitFor(() =>
      expect(updateEligibilityMock).toHaveBeenCalledWith(
        {
          providerID: 'focused-provider',
          modelID: 'focused-model',
          enabled: false,
        },
        '/focused/directory',
      ),
    )
  })

  it('shows eligibility loading and error states with retry', async () => {
    const pending = Promise.withResolvers<RemoteCompactionEligibilityList>()
    getEligibilityMock.mockReturnValueOnce(pending.promise)
    render(<CompactionSettings />)
    expect(await screen.findByRole('status')).toHaveTextContent('compaction.eligibilityLoading')
    await act(() => pending.reject(new Error('eligibility unavailable')))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'compaction.eligibilityLoadError: eligibility unavailable',
    )
    fireEvent.click(screen.getByRole('button', { name: 'compaction.retry' }))
    await waitFor(() => expect(getEligibilityMock).toHaveBeenCalledTimes(2))
  })
})

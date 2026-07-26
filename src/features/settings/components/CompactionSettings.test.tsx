import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RemoteCompactionEligibility,
  RemoteCompactionEligibilityList,
  RemoteCompactionResolution,
} from '../../../types/api/config'
import { CompactionSettings } from './CompactionSettings'

const {
  getCurrentProjectMock,
  getEligibilityMock,
  getStatusMock,
  updateEligibilityMock,
  updatePolicyMock,
  useDirectoryMock,
  usePaneControllerMock,
  usePaneLayoutMock,
  useServerStoreMock,
} = vi.hoisted(() => ({
  getCurrentProjectMock: vi.fn(),
  getEligibilityMock: vi.fn(),
  getStatusMock: vi.fn(),
  updateEligibilityMock: vi.fn(),
  updatePolicyMock: vi.fn(),
  useDirectoryMock: vi.fn(),
  usePaneControllerMock: vi.fn(),
  usePaneLayoutMock: vi.fn(),
  useServerStoreMock: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const details = [
        values?.identity,
        values?.project,
        values?.scope,
        values?.directory,
        values?.providerID,
        values?.modelID,
        values?.error,
      ].filter((value): value is string => typeof value === 'string')
      return details.length > 0 ? `${key}: ${details.join(' · ')}` : key
    },
  }),
}))

vi.mock('../../../api/client', () => ({ getCurrentProject: getCurrentProjectMock }))

vi.mock('../../../api/config', () => ({
  getRemoteCompactionEligibility: getEligibilityMock,
  getRemoteCompactionStatus: getStatusMock,
  updateRemoteCompactionEligibility: updateEligibilityMock,
  updateRemoteCompactionPolicy: updatePolicyMock,
}))

vi.mock('../../../contexts/useDirectory', () => ({ useDirectory: useDirectoryMock }))

vi.mock('../../../store/paneControllerStore', () => ({ usePaneController: usePaneControllerMock }))
vi.mock('../../../store/paneLayoutStore', () => ({ usePaneLayout: usePaneLayoutMock }))
vi.mock('../../../hooks/useServerStore', () => ({ useServerStore: useServerStoreMock }))

const eligibility = list([
  item('focused-provider', 'focused-model', { configurable: true, enabled: 'disabled' }),
  item('other-provider', 'other-model', { configurable: true, enabled: 'disabled' }),
])
let activeServerID = 'server-a'
let activeController = controller('/focused/directory')

function statusFor(providerID: string, modelID: string): RemoteCompactionResolution {
  return {
    configured: {
      mode: 'auto',
      protocol: 'v2',
      metadata: {
        remote: { source: 'project', explicitAtWriteTarget: true },
        remote_protocol: { source: 'global', explicitAtWriteTarget: false },
        writeTarget: { source: 'project', format: 'json', exists: true },
      },
    },
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
  options: {
    configurable: boolean
    enabled: 'enabled' | 'disabled' | 'unset'
    wireApi?: 'chat' | 'responses'
    explicit?: boolean
  } = {
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
    metadata: {
      modelRemoteCompaction: {
        source: options.explicit === false || options.enabled === 'unset' ? ('global' as const) : ('project' as const),
        explicitAtWriteTarget: options.explicit ?? options.enabled !== 'unset',
      },
      protocols: { source: 'project' as const, explicitAtWriteTarget: true },
      writeTarget: { source: 'project' as const, format: 'json' as const, exists: true },
    },
  }
}

function list(items: ReturnType<typeof item>[]): RemoteCompactionEligibilityList {
  return { items }
}

function projectFor(directory: string, options: { name?: string; worktree?: string; sandboxes?: string[] } = {}) {
  const parts = directory.replace(/\\/g, '/').split('/').filter(Boolean)
  return {
    id: `project:${options.worktree ?? directory}`,
    worktree: options.worktree ?? directory,
    name: options.name ?? parts[parts.length - 1] ?? directory,
    sandboxes: options.sandboxes ?? [],
    time: { created: 0, updated: 0 },
  }
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

function scopeFor(directory: string, serverID = activeServerID) {
  return { serverID, directory }
}

function statusCall(
  providerID: string,
  modelID: string,
  directory: string,
  sessionID?: string,
  serverID = activeServerID,
) {
  return {
    args: [{ providerID, modelID, ...(sessionID ? { sessionID } : {}) }, scopeFor(directory, serverID)],
  }
}

describe('CompactionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeServerID = 'server-a'
    activeController = controller('/focused/directory')
    usePaneLayoutMock.mockReturnValue({ focusedPaneId: 'focused-pane' })
    usePaneControllerMock.mockImplementation(() => activeController)
    useDirectoryMock.mockReturnValue({ currentDirectory: '/focused/directory' })
    useServerStoreMock.mockImplementation(() => ({ activeServer: { id: activeServerID } }))
    getCurrentProjectMock.mockImplementation((scope: { directory: string }) =>
      Promise.resolve(
        projectFor(scope.directory, { name: scope.directory === '/focused/directory' ? 'Focused Project' : undefined }),
      ),
    )
    getEligibilityMock.mockResolvedValue(eligibility)
    getStatusMock.mockImplementation(({ providerID, modelID }: { providerID: string; modelID: string }) =>
      Promise.resolve(statusFor(providerID, modelID)),
    )
    updateEligibilityMock.mockResolvedValue(eligibility.items[0])
    updatePolicyMock.mockResolvedValue({ remote: 'on', remote_protocol: 'v2' })
  })

  it('loads the focused project scope and initializes session-aware status', async () => {
    const view = renderSettings()

    expect(await screen.findByText('Focused Project')).toBeInTheDocument()
    expect(screen.getByText('compaction.scopeProjectRoot')).toBeInTheDocument()
    expect(screen.getAllByText('/focused/directory')).toHaveLength(2)
    expect(getCurrentProjectMock).toHaveBeenCalledWith(scopeFor('/focused/directory'))
    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))
    expect(screen.getByRole('combobox', { name: 'compaction.model' })).toHaveValue('focused-model')
    expect(screen.getByText('compaction.eligibilityStates.disabled')).toBeInTheDocument()
    expect(getEligibilityMock).toHaveBeenCalledWith(scopeFor('/focused/directory'))
    await waitFor(() =>
      expect(getStatusMock).toHaveBeenCalledWith(
        ...statusCall('focused-provider', 'focused-model', '/focused/directory', 'focused-session').args,
      ),
    )
  })

  it('uses the current directory while the focused pane controller is not ready', async () => {
    activeController = controller('')
    useDirectoryMock.mockReturnValue({ currentDirectory: '/context/project' })
    getCurrentProjectMock.mockResolvedValue(projectFor('/context/project', { name: 'Context Project' }))

    renderSettings()

    expect(await screen.findByText('Context Project')).toBeInTheDocument()
    expect(screen.getByText('compaction.scopeProjectRoot')).toBeInTheDocument()
    expect(screen.getAllByText('/context/project')).toHaveLength(2)
    expect(getCurrentProjectMock).toHaveBeenCalledWith(scopeFor('/context/project'))
  })

  it('shows the project worktree and effective sandbox directory before policy controls', async () => {
    activeController = controller('/workspace/sandbox/nested')
    getCurrentProjectMock.mockResolvedValue(
      projectFor('/workspace/sandbox/nested', {
        name: 'Workspace Project',
        worktree: '/workspace/root',
        sandboxes: ['/workspace/sandbox'],
      }),
    )

    renderSettings()

    expect(await screen.findByText('Workspace Project')).toBeInTheDocument()
    expect(screen.getByText('/workspace/root')).toBeInTheDocument()
    expect(screen.getByText('/workspace/sandbox/nested')).toBeInTheDocument()
    expect(screen.getByText('compaction.scopeSandbox')).toBeInTheDocument()
  })

  it('separates saved policy intent from the current model result', async () => {
    getStatusMock.mockImplementation(({ providerID, modelID }: { providerID: string; modelID: string }) =>
      Promise.resolve({
        ...statusFor(providerID, modelID),
        configured: { mode: 'on', protocol: 'v2' },
        mode: 'local',
        target: 'local',
        protocols: [],
        reason: 'model_disabled',
      }),
    )

    renderSettings()

    expect(await screen.findByText('compaction.policyIntents.on')).toBeInTheDocument()
    expect(screen.getByText('compaction.effectiveLocal')).toBeInTheDocument()
    expect(screen.getByText('compaction.reasons.model_disabled')).toBeInTheDocument()
    expect(screen.getByText('compaction.reasons.model_disabled (model_disabled)')).toBeInTheDocument()
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

  it('keeps policy changes as a draft and confirms the identity captured when applying', async () => {
    const policy = Promise.withResolvers<{ remote: 'on'; remote_protocol: 'v2' }>()
    updatePolicyMock.mockReturnValue(policy.promise)
    const view = renderSettings()
    expect(await screen.findByText('compaction.policyIntents.auto')).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: 'compaction.applyPolicy: Focused Project' })
    expect(apply).toBeDisabled()
    getStatusMock.mockClear()
    getEligibilityMock.mockClear()

    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOn' }))
    expect(screen.getByText('compaction.unsavedPolicy')).toBeInTheDocument()
    expect(updatePolicyMock).not.toHaveBeenCalled()
    expect(apply).toBeEnabled()
    fireEvent.click(apply)
    await waitFor(() =>
      expect(updatePolicyMock).toHaveBeenCalledWith({ remote: 'on' }, undefined, scopeFor('/focused/directory')),
    )
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
        ...statusCall('focused-provider', 'focused-model', '/focused/directory', 'focused-session').args,
      ),
    )
    await waitFor(() => expect(getEligibilityMock).toHaveBeenCalledWith(scopeFor('/focused/directory')))
    expect(getStatusMock).not.toHaveBeenCalledWith(
      ...statusCall('other-provider', 'other-model', '/focused/directory').args,
    )
  })

  it('does not show a late save receipt after switching directories', async () => {
    const policy = Promise.withResolvers<{ remote: 'on'; remote_protocol: 'v2' }>()
    updatePolicyMock.mockReturnValue(policy.promise)
    getCurrentProjectMock.mockImplementation((scope: { directory: string }) =>
      Promise.resolve(
        projectFor(scope.directory, { name: scope.directory === '/project-a' ? 'Project A' : 'Project B' }),
      ),
    )
    activeController = controller('/project-a')
    const view = renderSettings()

    expect(await screen.findByText('Project A')).toBeInTheDocument()
    expect(await screen.findByText('compaction.policyIntents.auto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOn' }))
    fireEvent.click(screen.getByRole('button', { name: 'compaction.applyPolicy: Project A' }))
    await waitFor(() =>
      expect(updatePolicyMock).toHaveBeenCalledWith({ remote: 'on' }, undefined, scopeFor('/project-a')),
    )

    await act(() => {
      activeController = controller('/project-b')
      view.rerender(<CompactionSettings />)
    })
    expect(await screen.findByText('Project B')).toBeInTheDocument()

    await act(() => policy.resolve({ remote: 'on', remote_protocol: 'v2' }))
    expect(screen.queryByText('compaction.savedToScope: Project A · /project-a')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'compaction.applyPolicy: Project B' })).toBeDisabled()
  })

  it('ignores out-of-order directory eligibility results and writes eligibility in the current directory', async () => {
    const first = Promise.withResolvers<RemoteCompactionEligibilityList>()
    const second = Promise.withResolvers<RemoteCompactionEligibilityList>()
    getEligibilityMock.mockImplementation((scope: { directory: string }) =>
      scope.directory === '/project-a' ? first.promise : second.promise,
    )
    activeController = controller('/project-a')
    const view = renderSettings()
    await waitFor(() => expect(getEligibilityMock).toHaveBeenCalledWith(scopeFor('/project-a')))
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
        scopeFor('/project-b'),
      ),
    )
  })

  it('ignores a stale successful eligibility response from the previous directory', async () => {
    const first = Promise.withResolvers<RemoteCompactionEligibilityList>()
    const second = Promise.withResolvers<RemoteCompactionEligibilityList>()
    getEligibilityMock.mockImplementation((scope: { directory: string }) =>
      scope.directory === '/project-a' ? first.promise : second.promise,
    )
    activeController = controller('/project-a')
    const view = renderSettings()
    await waitFor(() => expect(getEligibilityMock).toHaveBeenCalledWith(scopeFor('/project-a')))
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
    expect(screen.getByText('compaction.eligibilityStates.unset')).toBeInTheDocument()
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
        scopeFor('/focused/directory'),
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
        scopeFor('/focused/directory'),
      ),
    )
  })

  it('shows eligibility loading and error states with retry', async () => {
    const pending = Promise.withResolvers<RemoteCompactionEligibilityList>()
    getEligibilityMock.mockReturnValueOnce(pending.promise)
    render(<CompactionSettings />)
    expect(await screen.findByText('compaction.eligibilityLoading')).toBeInTheDocument()
    await act(() => pending.reject(new Error('eligibility unavailable')))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'compaction.eligibilityLoadError: eligibility unavailable',
    )
    fireEvent.click(screen.getByRole('button', { name: 'compaction.retry' }))
    await waitFor(() => expect(getEligibilityMock).toHaveBeenCalledTimes(2))
  })

  it('distinguishes policy write failure from a saved policy whose status refresh failed', async () => {
    activeController = controller('/policy-write-failure')
    updatePolicyMock.mockRejectedValueOnce(new Error('write denied'))
    const view = renderSettings()
    expect(await screen.findByText('compaction.policyIntents.auto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOn' }))
    fireEvent.click(screen.getByRole('button', { name: 'compaction.applyPolicy: policy-write-failure' }))
    expect(await screen.findByText(/compaction.policyWriteError: policy-write-failure/)).toHaveTextContent(
      'write denied',
    )
    expect(screen.getByText('compaction.unsavedPolicy')).toBeInTheDocument()
    view.unmount()

    activeController = controller('/policy-refresh-failure')
    let failRefresh = false
    getStatusMock.mockImplementation(({ providerID, modelID }: { providerID: string; modelID: string }) =>
      failRefresh ? Promise.reject(new Error('status offline')) : Promise.resolve(statusFor(providerID, modelID)),
    )
    renderSettings()
    expect(await screen.findByText('compaction.policyIntents.auto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOn' }))
    failRefresh = true
    fireEvent.click(screen.getByRole('button', { name: 'compaction.applyPolicy: policy-refresh-failure' }))
    expect(await screen.findByText(/compaction.policySavedRefreshError: policy-refresh-failure/)).toBeInTheDocument()
    expect(screen.getByText('focused-provider/focused-model')).toBeInTheDocument()
    expect(screen.queryByText(/compaction.savedToScope: policy-refresh-failure/)).not.toBeInTheDocument()

    failRefresh = false
    fireEvent.click(screen.getByRole('button', { name: 'compaction.retryStatusRefresh' }))
    expect(await screen.findByText(/compaction.savedToScope: policy-refresh-failure/)).toBeInTheDocument()
    expect(screen.getByText('compaction.policyUpToDate')).toBeInTheDocument()
  })

  it('clears an eligibility refresh error after a later manual refresh succeeds', async () => {
    getEligibilityMock
      .mockResolvedValueOnce(eligibility)
      .mockRejectedValueOnce(new Error('eligibility offline'))
      .mockResolvedValueOnce(eligibility)
    const view = renderSettings()
    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))
    fireEvent.click(screen.getByRole('switch', { name: 'compaction.enableEligibility' }))
    expect(await screen.findByText('compaction.eligibilitySavedRefreshError')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'compaction.refreshEligibility' }))

    expect(await screen.findByText(/compaction.eligibilitySaved: focused-provider · focused-model/)).toBeInTheDocument()
    expect(screen.queryByText('compaction.eligibilitySavedRefreshError')).not.toBeInTheDocument()
  })

  it('keeps an eligibility receipt pending until its failed status refresh succeeds', async () => {
    let failStatus = false
    getStatusMock.mockImplementation(({ providerID, modelID }: { providerID: string; modelID: string }) =>
      failStatus ? Promise.reject(new Error('status offline')) : Promise.resolve(statusFor(providerID, modelID)),
    )
    const view = renderSettings()
    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))
    expect(await screen.findByText('compaction.policyIntents.auto')).toBeInTheDocument()
    failStatus = true
    fireEvent.click(screen.getByRole('switch', { name: 'compaction.enableEligibility' }))
    expect(await screen.findByText('compaction.eligibilitySavedRefreshError')).toBeInTheDocument()

    failStatus = false
    fireEvent.click(screen.getByRole('button', { name: 'compaction.refreshEligibility' }))
    await waitFor(() => expect(getEligibilityMock).toHaveBeenCalledTimes(3))
    expect(screen.getByText('compaction.eligibilitySavedRefreshError')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'compaction.refreshStatus' }))
    expect(await screen.findByText(/compaction.eligibilitySaved: focused-provider · focused-model/)).toBeInTheDocument()
  })

  it('locks policy controls while retrying a saved-policy refresh', async () => {
    let failRefresh = false
    getStatusMock.mockImplementation(({ providerID, modelID }: { providerID: string; modelID: string }) =>
      failRefresh ? Promise.reject(new Error('status offline')) : Promise.resolve(statusFor(providerID, modelID)),
    )
    renderSettings()
    expect(await screen.findByText('compaction.policyIntents.auto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOn' }))
    failRefresh = true
    fireEvent.click(screen.getByRole('button', { name: 'compaction.applyPolicy: Focused Project' }))
    expect(await screen.findByText(/compaction.policySavedRefreshError: Focused Project/)).toBeInTheDocument()

    const retry = Promise.withResolvers<RemoteCompactionResolution>()
    failRefresh = false
    getStatusMock.mockReturnValueOnce(retry.promise)
    fireEvent.click(screen.getByRole('button', { name: 'compaction.retryStatusRefresh' }))

    await waitFor(() => expect(screen.getByRole('radio', { name: 'compaction.policyOff' })).toBeDisabled())
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOff' }))
    expect(updatePolicyMock).toHaveBeenCalledTimes(1)

    await act(() => retry.resolve(statusFor('focused-provider', 'focused-model')))
    expect(await screen.findByText(/compaction.savedToScope: Focused Project/)).toBeInTheDocument()
  })

  it('keeps project scope data through refresh failure, ignores stale directories, and retries independently', async () => {
    const projectA = Promise.withResolvers<ReturnType<typeof projectFor>>()
    const projectB = projectFor('/scope-b', { name: 'Project B' })
    getCurrentProjectMock.mockImplementation((scope: { directory: string }) => {
      if (scope.directory === '/scope-a') return projectA.promise
      return Promise.resolve(projectB)
    })
    activeController = controller('/scope-a')
    const view = renderSettings()
    await waitFor(() => expect(getCurrentProjectMock).toHaveBeenCalledWith(scopeFor('/scope-a')))
    activeController = controller('/scope-b')
    view.rerender(<CompactionSettings />)
    expect(await screen.findByText('Project B')).toBeInTheDocument()
    await act(() => projectA.resolve(projectFor('/scope-a', { name: 'Project A' })))
    expect(screen.queryByText('Project A')).not.toBeInTheDocument()

    getCurrentProjectMock.mockRejectedValueOnce(new Error('scope offline'))
    fireEvent.click(screen.getByRole('button', { name: 'compaction.refreshScope' }))
    expect(await screen.findByText(/compaction.scopeLoadError: scope offline/)).toBeInTheDocument()
    expect(screen.getByText('Project B')).toBeInTheDocument()
    getCurrentProjectMock.mockResolvedValueOnce(projectFor('/scope-b', { name: 'Project B refreshed' }))
    fireEvent.click(screen.getByRole('button', { name: 'compaction.retry' }))
    expect(await screen.findByText('Project B refreshed')).toBeInTheDocument()
  })

  it('does not show a delayed eligibility write failure after switching directory and model identity', async () => {
    const pending = Promise.withResolvers<RemoteCompactionEligibility>()
    updateEligibilityMock.mockReturnValue(pending.promise)
    activeController = controller('/eligibility-a')
    const view = renderSettings()
    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))
    fireEvent.click(screen.getByRole('switch', { name: 'compaction.enableEligibility' }))

    activeController = controller('/eligibility-b', {
      currentProviderId: 'other-provider',
      currentModelId: 'other-model',
      sessionId: null,
    })
    view.rerender(<CompactionSettings />)
    await waitFor(() => expect(view.provider()).toHaveValue('other-provider'))
    await act(() => pending.reject(new Error('late eligibility denial')))
    expect(screen.queryByText(/compaction.eligibilityWriteError/)).not.toBeInTheDocument()
  })

  it('restores an unsaved policy draft after the settings component is closed and reopened', async () => {
    activeController = controller('/draft-recovery')
    const first = renderSettings()
    expect(await screen.findByText('compaction.policyIntents.auto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOff' }))
    expect(screen.getByText('compaction.unsavedPolicy')).toBeInTheDocument()
    first.unmount()

    renderSettings()
    expect(await screen.findByRole('radio', { name: 'compaction.policyOff' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('compaction.unsavedPolicy')).toBeInTheDocument()
  })

  it('shows provenance and restores project policy inheritance with null patches', async () => {
    renderSettings()
    expect(await screen.findByText('compaction.policyIntents.auto')).toBeInTheDocument()

    expect(
      screen.getAllByText('compaction.sources.project (project) · compaction.explicitOverride').length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('compaction.sources.global (global) · compaction.inheritedValue')).toBeInTheDocument()
    expect(screen.getByText('compaction.policyWriteTarget')).toBeInTheDocument()
    expect(screen.getByText('compaction.eligibilityWriteTarget')).toBeInTheDocument()
    expect(screen.getAllByText(/compaction.projectWriteTarget · json · compaction.writeTargetExists/)).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'compaction.restorePolicyInheritance' }))
    await waitFor(() =>
      expect(updatePolicyMock).toHaveBeenCalledWith(
        { remote: null, remote_protocol: null },
        undefined,
        scopeFor('/focused/directory'),
      ),
    )
  })

  it('restores model eligibility inheritance with an explicit null state', async () => {
    const view = renderSettings()
    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))

    const restore = screen.getByRole('button', { name: 'compaction.restoreEligibilityInheritance' })
    expect(restore).toBeEnabled()
    fireEvent.click(restore)

    await waitFor(() =>
      expect(updateEligibilityMock).toHaveBeenCalledWith(
        { providerID: 'focused-provider', modelID: 'focused-model', enabled: null },
        scopeFor('/focused/directory'),
      ),
    )
  })

  it('preserves the current directory refresh receipt when an earlier directory save finishes later', async () => {
    const saveA = Promise.withResolvers<{ remote: 'on'; remote_protocol: 'v2' }>()
    const saveB = Promise.withResolvers<{ remote: 'off'; remote_protocol: 'v2' }>()
    let failBRefresh = false
    updatePolicyMock.mockImplementation((_patch: unknown, _sessionID: unknown, scope: { directory: string }) =>
      scope.directory === '/receipt-a' ? saveA.promise : saveB.promise,
    )
    getCurrentProjectMock.mockImplementation((scope: { directory: string }) =>
      Promise.resolve(
        projectFor(scope.directory, { name: scope.directory === '/receipt-a' ? 'Receipt A' : 'Receipt B' }),
      ),
    )
    getStatusMock.mockImplementation(
      ({ providerID, modelID }: { providerID: string; modelID: string }, scope: { directory: string }) =>
        failBRefresh && scope.directory === '/receipt-b'
          ? Promise.reject(new Error('B status offline'))
          : Promise.resolve(statusFor(providerID, modelID)),
    )

    activeController = controller('/receipt-a')
    const view = renderSettings()
    expect(await screen.findByText('Receipt A')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOn' }))
    fireEvent.click(screen.getByRole('button', { name: 'compaction.applyPolicy: Receipt A' }))

    activeController = controller('/receipt-b')
    view.rerender(<CompactionSettings />)
    expect(await screen.findByText('Receipt B')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOff' }))
    fireEvent.click(screen.getByRole('button', { name: 'compaction.applyPolicy: Receipt B' }))

    failBRefresh = true
    await act(() => saveB.resolve({ remote: 'off', remote_protocol: 'v2' }))
    expect(await screen.findByText(/compaction.policySavedRefreshError: Receipt B/)).toBeInTheDocument()

    await act(() => saveA.resolve({ remote: 'on', remote_protocol: 'v2' }))
    expect(screen.getByText(/compaction.policySavedRefreshError: Receipt B/)).toBeInTheDocument()
  })

  it('isolates same-directory caches and drafts across servers', async () => {
    activeController = controller('/shared-server-scope', {
      currentProviderId: undefined,
      currentModelId: undefined,
      sessionId: null,
    })
    getCurrentProjectMock.mockImplementation((scope: { serverID: string; directory: string }) =>
      Promise.resolve(
        projectFor(scope.directory, { name: scope.serverID === 'server-a' ? 'Server A Project' : 'Server B Project' }),
      ),
    )
    getEligibilityMock.mockImplementation((scope: { serverID: string }) =>
      Promise.resolve(
        list([scope.serverID === 'server-a' ? item('provider-a', 'model-a') : item('provider-b', 'model-b')]),
      ),
    )
    const view = renderSettings()

    expect(await screen.findByText('Server A Project')).toBeInTheDocument()
    await waitFor(() => expect(view.provider()).toHaveValue('provider-a'))
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOff' }))
    expect(screen.getByText('compaction.unsavedPolicy')).toBeInTheDocument()

    await act(() => {
      activeServerID = 'server-b'
      view.rerender(<CompactionSettings />)
    })
    expect(await screen.findByText('Server B Project')).toBeInTheDocument()
    await waitFor(() => expect(view.provider()).toHaveValue('provider-b'))
    expect(screen.queryByText('compaction.unsavedPolicy')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'compaction.policyAuto' })).toHaveAttribute('aria-checked', 'true')

    await act(() => {
      activeServerID = 'server-a'
      view.rerender(<CompactionSettings />)
    })
    expect(await screen.findByText('Server A Project')).toBeInTheDocument()
    await waitFor(() => expect(view.provider()).toHaveValue('provider-a'))
    expect(screen.getByRole('radio', { name: 'compaction.policyOff' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('compaction.unsavedPolicy')).toBeInTheDocument()
    expect(getEligibilityMock).toHaveBeenCalledWith(scopeFor('/shared-server-scope', 'server-a'))
    expect(getEligibilityMock).toHaveBeenCalledWith(scopeFor('/shared-server-scope', 'server-b'))
  })

  it('uses the captured server for a save that finishes after a same-directory server switch', async () => {
    const policy = Promise.withResolvers<{ remote: 'on'; remote_protocol: 'v2' }>()
    updatePolicyMock.mockReturnValue(policy.promise)
    getCurrentProjectMock.mockImplementation((scope: { serverID: string; directory: string }) =>
      Promise.resolve(projectFor(scope.directory, { name: scope.serverID === 'server-a' ? 'Server A' : 'Server B' })),
    )
    const view = renderSettings()
    expect(await screen.findByText('Server A')).toBeInTheDocument()
    expect(await screen.findByText('compaction.policyIntents.auto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOn' }))
    fireEvent.click(screen.getByRole('button', { name: 'compaction.applyPolicy: Server A' }))
    await waitFor(() =>
      expect(updatePolicyMock).toHaveBeenCalledWith(
        { remote: 'on' },
        undefined,
        scopeFor('/focused/directory', 'server-a'),
      ),
    )

    await act(() => {
      activeServerID = 'server-b'
      view.rerender(<CompactionSettings />)
    })
    expect(await screen.findByText('Server B')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('compaction.policyIntents.auto')).toBeInTheDocument())
    getStatusMock.mockClear()

    await act(() => policy.resolve({ remote: 'on', remote_protocol: 'v2' }))
    await waitFor(() =>
      expect(getStatusMock).toHaveBeenCalledWith(
        ...statusCall('focused-provider', 'focused-model', '/focused/directory', 'focused-session', 'server-a').args,
      ),
    )
    expect(getStatusMock).not.toHaveBeenCalledWith(
      ...statusCall('focused-provider', 'focused-model', '/focused/directory', 'focused-session', 'server-b').args,
    )
    expect(screen.queryByText(/compaction.savedToScope: Server A/)).not.toBeInTheDocument()
  })

  it('confirms a policy save when its refresh is superseded by a newer successful status refresh', async () => {
    const saveRefresh = Promise.withResolvers<RemoteCompactionResolution>()
    const newerRefresh = Promise.withResolvers<RemoteCompactionResolution>()
    let calls = 0
    getStatusMock.mockImplementation(({ providerID, modelID }: { providerID: string; modelID: string }) => {
      calls++
      if (calls === 1) return Promise.resolve(statusFor(providerID, modelID))
      if (calls === 2) return saveRefresh.promise
      return newerRefresh.promise
    })
    renderSettings()
    expect(await screen.findByText('compaction.policyIntents.auto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'compaction.policyOn' }))
    fireEvent.click(screen.getByRole('button', { name: 'compaction.applyPolicy: Focused Project' }))
    await waitFor(() => expect(getStatusMock).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'compaction.refreshStatus' }))
    await waitFor(() => expect(getStatusMock).toHaveBeenCalledTimes(3))
    await act(() => newerRefresh.resolve(statusFor('focused-provider', 'focused-model')))
    await act(() => saveRefresh.reject(new Error('superseded refresh failed')))

    expect(await screen.findByText(/compaction.savedToScope: Focused Project/)).toBeInTheDocument()
    expect(screen.queryByText(/compaction.policySavedRefreshError/)).not.toBeInTheDocument()
  })

  it('confirms an eligibility save when its refresh is superseded by a newer successful eligibility refresh', async () => {
    const saveRefresh = Promise.withResolvers<RemoteCompactionEligibilityList>()
    const newerRefresh = Promise.withResolvers<RemoteCompactionEligibilityList>()
    let calls = 0
    getEligibilityMock.mockImplementation(() => {
      calls++
      if (calls === 1) return Promise.resolve(eligibility)
      if (calls === 2) return saveRefresh.promise
      return newerRefresh.promise
    })
    const view = renderSettings()
    await waitFor(() => expect(view.provider()).toHaveValue('focused-provider'))
    fireEvent.click(screen.getByRole('switch', { name: 'compaction.enableEligibility' }))
    await waitFor(() => expect(getEligibilityMock).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'compaction.refreshEligibility' }))
    await waitFor(() => expect(getEligibilityMock).toHaveBeenCalledTimes(3))
    await act(() =>
      newerRefresh.resolve(
        list([item('focused-provider', 'focused-model', { configurable: true, enabled: 'enabled' })]),
      ),
    )
    await act(() => saveRefresh.reject(new Error('superseded eligibility refresh failed')))

    expect(await screen.findByText(/compaction.eligibilitySaved: focused-provider · focused-model/)).toBeInTheDocument()
    expect(screen.queryByText('compaction.eligibilitySavedRefreshError')).not.toBeInTheDocument()
  })
})

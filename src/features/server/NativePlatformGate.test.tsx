import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NativePlatformGate } from './NativePlatformGate'

const mocks = vi.hoisted(() => {
  let activeServer: { id: string; name: string; url: string } | null = null
  const listeners = new Set<() => void>()
  return {
    checkHealth: vi.fn(),
    addServer: vi.fn((config: { name: string; url: string }) => ({ id: 'remote-1', ...config })),
    setActiveServer: vi.fn(() => {
      activeServer = { id: 'remote-1', name: 'Remote', url: 'https://chimera.example' }
      listeners.forEach(listener => listener())
      return true
    }),
    reset() {
      activeServer = null
      listeners.clear()
    },
    serverStore: {
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getActiveServer() {
        return activeServer
      },
      addServer(config: { name: string; url: string }) {
        return mocks.addServer(config)
      },
      setActiveServer(id: string) {
        return mocks.setActiveServer(id)
      },
    },
  }
})

vi.mock('../../api/health', () => ({
  checkCandidateServerHealth: mocks.checkHealth,
}))

vi.mock('../../store/serverStore', () => ({
  serverStore: mocks.serverStore,
}))

const win = window as Window & {
  __TAURI_INTERNALS__?: object
  __CHIMERA_RUNTIME_PLATFORM__?: 'tauri-android' | 'tauri-ios'
}

describe('NativePlatformGate', () => {
  beforeEach(() => {
    mocks.reset()
    mocks.checkHealth.mockReset()
    mocks.addServer.mockClear()
    mocks.setActiveServer.mockClear()
    win.__TAURI_INTERNALS__ = {}
  })

  it('renders an explicit unsupported state for native iOS', () => {
    win.__CHIMERA_RUNTIME_PLATFORM__ = 'tauri-ios'

    render(
      <NativePlatformGate>
        <div>Application</div>
      </NativePlatformGate>,
    )

    expect(screen.getByText('Chimera for iOS is not supported yet')).toBeInTheDocument()
    expect(screen.queryByText('Application')).not.toBeInTheDocument()
  })

  it('keeps the Android application gated until a healthy remote server is selected', async () => {
    win.__CHIMERA_RUNTIME_PLATFORM__ = 'tauri-android'
    mocks.checkHealth.mockResolvedValue({ status: 'online', lastCheck: 1, details: '', version: '1.0.0' })

    render(
      <NativePlatformGate>
        <div>Application</div>
      </NativePlatformGate>,
    )

    expect(screen.queryByText('Application')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://chimera.example/path' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(screen.getByText('Application')).toBeInTheDocument())
    expect(mocks.checkHealth).toHaveBeenCalledWith({ serverUrl: 'https://chimera.example/path', auth: undefined })
    expect(mocks.addServer).toHaveBeenCalledWith({
      name: 'Remote',
      url: 'https://chimera.example/path',
      auth: undefined,
    })
    expect(mocks.setActiveServer).toHaveBeenCalledWith('remote-1')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  channels,
  getActiveServerIdMock,
  getServerAuthMock,
  getServerBaseUrlMock,
  invokeMock,
  makeBasicAuthHeaderMock,
} = vi.hoisted(() => ({
  channels: [] as Array<{ onmessage?: (message: unknown) => void }>,
  getActiveServerIdMock: vi.fn(() => 'remote'),
  getServerAuthMock: vi.fn<(serverID: string) => { username: string; password: string } | null>(() => ({
    username: 'chimera',
    password: 'secret',
  })),
  getServerBaseUrlMock: vi.fn(() => 'https://terminal.example.test'),
  invokeMock: vi.fn(() => Promise.resolve()),
  makeBasicAuthHeaderMock: vi.fn(() => 'Basic bridge-token'),
}))

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    onmessage?: (message: unknown) => void

    constructor() {
      channels.push(this)
    }
  },
  invoke: invokeMock,
}))

vi.mock('../store/serverStore', () => ({
  makeBasicAuthHeader: makeBasicAuthHeaderMock,
  serverStore: {
    getActiveServerId: getActiveServerIdMock,
    getServerAuth: getServerAuthMock,
    getServerBaseUrl: getServerBaseUrlMock,
  },
}))

import { connectTauriPty } from './ptyBridge'

describe('Tauri PTY bridge transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    channels.length = 0
    getActiveServerIdMock.mockReturnValue('remote')
    getServerBaseUrlMock.mockReturnValue('https://terminal.example.test')
    getServerAuthMock.mockReturnValue({ username: 'chimera', password: 'secret' })
    invokeMock.mockResolvedValue(undefined)
  })

  it('uses the selected server scope with header auth and no URL credentials', async () => {
    await connectTauriPty({
      ptyId: 'pty-1',
      apiScope: { serverID: 'remote', directory: '/instance workspace' },
      cursor: -1,
      onConnected: vi.fn(),
      onMessage: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    })

    expect(getServerAuthMock).toHaveBeenCalledWith('remote')
    expect(makeBasicAuthHeaderMock).toHaveBeenCalledWith({ username: 'chimera', password: 'secret' })
    expect(invokeMock).toHaveBeenCalledWith('bridge_connect', {
      args: {
        bridgeId: expect.stringContaining(':pty-1:'),
        url: 'wss://terminal.example.test/pty/pty-1/connect?directory=%2Finstance%20workspace&cursor=-1',
        authHeader: 'Basic bridge-token',
      },
      onEvent: channels[0],
    })
  })

  it('maps bridge events and connection send/close commands', async () => {
    const onConnected = vi.fn()
    const onMessage = vi.fn()
    const onDisconnected = vi.fn()
    const onError = vi.fn()
    const connection = await connectTauriPty({
      ptyId: 'pty-2',
      onConnected,
      onMessage,
      onDisconnected,
      onError,
    })
    const emit = channels[0].onmessage as (message: unknown) => void

    emit({ event: 'connected' })
    emit({ event: 'data', data: { data: 'hello' } })
    emit({ event: 'error', data: { message: 'bridge warning' } })
    connection.send('input')
    connection.close()
    connection.send('ignored')
    emit({ event: 'data', data: { data: 'ignored' } })

    expect(onConnected).toHaveBeenCalledOnce()
    expect(onMessage).toHaveBeenCalledWith('hello')
    expect(onError).toHaveBeenCalledWith('bridge warning')
    expect(onDisconnected).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenCalledWith('bridge_send', {
      args: { bridgeId: expect.stringContaining(':pty-2:'), data: 'input' },
    })
    expect(invokeMock).toHaveBeenCalledWith('bridge_disconnect', {
      args: { bridgeId: expect.stringContaining(':pty-2:') },
    })
    expect(invokeMock).not.toHaveBeenCalledWith('bridge_send', {
      args: { bridgeId: expect.stringContaining(':pty-2:'), data: 'ignored' },
    })
  })

  it('disconnects again if the bridge finishes connecting after close', async () => {
    const onConnected = vi.fn()
    const connection = await connectTauriPty({
      ptyId: 'pty-race',
      onConnected,
      onMessage: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    })
    const emit = channels[0].onmessage as (message: unknown) => void

    connection.close()
    emit({ event: 'connected' })

    expect(onConnected).not.toHaveBeenCalled()
    const disconnectBridgeIds = invokeMock.mock.calls
      .filter(([command]) => command === 'bridge_disconnect')
      .map(([, payload]) => (payload as { args: { bridgeId: string } }).args.bridgeId)
    expect(disconnectBridgeIds).toHaveLength(2)
    expect(new Set(disconnectBridgeIds).size).toBe(1)
  })

  it('isolates native bridge IDs by scope and connection generation', async () => {
    const callbacks = {
      onConnected: vi.fn(),
      onMessage: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    }

    await connectTauriPty({
      ptyId: 'pty-shared',
      apiScope: { serverID: 'remote', workspace: 'workspace-a' },
      ...callbacks,
    })
    await connectTauriPty({
      ptyId: 'pty-shared',
      apiScope: { serverID: 'remote', workspace: 'workspace-b' },
      ...callbacks,
    })

    const bridgeIds = invokeMock.mock.calls
      .filter(([command]) => command === 'bridge_connect')
      .map(([, payload]) => (payload as { args: { bridgeId: string } }).args.bridgeId)
    expect(bridgeIds).toHaveLength(2)
    expect(bridgeIds[0]).toContain('workspace-a')
    expect(bridgeIds[1]).toContain('workspace-b')
    expect(bridgeIds[0]).not.toBe(bridgeIds[1])
  })

  it('passes null auth when the scoped server has no password', async () => {
    getServerAuthMock.mockReturnValue(null)

    await connectTauriPty({
      ptyId: 'pty-3',
      apiScope: { serverID: 'remote', workspace: 'workspace-a' },
      cursor: 0,
      onConnected: vi.fn(),
      onMessage: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    })

    expect(invokeMock).toHaveBeenCalledWith('bridge_connect', {
      args: {
        bridgeId: expect.stringContaining(':pty-3:'),
        url: 'wss://terminal.example.test/pty/pty-3/connect?workspace=workspace-a&cursor=0',
        authHeader: null,
      },
      onEvent: channels[0],
    })
  })
})

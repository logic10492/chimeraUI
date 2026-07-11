import { beforeEach, describe, expect, it, vi } from 'vitest'

const { channels, getActiveAuthMock, getActiveBaseUrlMock, invokeMock, makeBasicAuthHeaderMock } = vi.hoisted(() => ({
  channels: [] as Array<{ onmessage?: (message: unknown) => void }>,
  getActiveAuthMock: vi.fn<() => { username: string; password: string } | null>(() => null),
  getActiveBaseUrlMock: vi.fn(() => 'https://terminal.example.test'),
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
    getActiveAuth: getActiveAuthMock,
    getActiveBaseUrl: getActiveBaseUrlMock,
  },
}))

import { connectTauriPty } from './ptyBridge'

describe('Tauri PTY bridge transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    channels.length = 0
    getActiveBaseUrlMock.mockReturnValue('https://terminal.example.test')
    getActiveAuthMock.mockReturnValue({ username: 'chimera', password: 'secret' })
    invokeMock.mockResolvedValue(undefined)
  })

  it('uses a header-authenticated URL without browser auth query parameters', async () => {
    await connectTauriPty({
      ptyId: 'pty-1',
      directory: '/instance workspace',
      cursor: -1,
      onConnected: vi.fn(),
      onMessage: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    })

    expect(makeBasicAuthHeaderMock).toHaveBeenCalledWith({ username: 'chimera', password: 'secret' })
    expect(invokeMock).toHaveBeenCalledWith('bridge_connect', {
      args: {
        bridgeId: 'pty-1',
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
      args: { bridgeId: 'pty-2', data: 'input' },
    })
    expect(invokeMock).toHaveBeenCalledWith('bridge_disconnect', {
      args: { bridgeId: 'pty-2' },
    })
    expect(invokeMock).not.toHaveBeenCalledWith('bridge_send', {
      args: { bridgeId: 'pty-2', data: 'ignored' },
    })
  })

  it('passes null auth when the active server has no password', async () => {
    getActiveAuthMock.mockReturnValue(null)

    await connectTauriPty({
      ptyId: 'pty-3',
      cursor: 0,
      onConnected: vi.fn(),
      onMessage: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    })

    expect(invokeMock).toHaveBeenCalledWith('bridge_connect', {
      args: {
        bridgeId: 'pty-3',
        url: 'wss://terminal.example.test/pty/pty-3/connect?cursor=0',
        authHeader: null,
      },
      onEvent: channels[0],
    })
  })
})

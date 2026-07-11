import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveServerIdMock, getSDKClientMock, getServerBaseUrlMock, ptyMock } = vi.hoisted(() => ({
  getActiveServerIdMock: vi.fn(() => 'local'),
  getSDKClientMock: vi.fn(),
  getServerBaseUrlMock: vi.fn((serverID: string) =>
    serverID === 'remote' ? 'https://terminal.example.test/api' : 'http://localhost:4096',
  ),
  ptyMock: {
    connectToken: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
    shells: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('./sdk', () => ({
  getSDKClient: getSDKClientMock,
  unwrap: <T>(result: { data?: T; error?: unknown }) => {
    if (result.error) throw result.error
    return result.data as T
  },
}))

vi.mock('../store/serverStore', () => ({
  makeBasicAuthHeader: vi.fn(),
  serverStore: {
    getActiveServerId: getActiveServerIdMock,
    getServerAuth: vi.fn(() => null),
    getServerBaseUrl: getServerBaseUrlMock,
  },
}))

import {
  buildPtyConnectUrl,
  createPtySession,
  getPtyConnectUrl,
  getPtySession,
  listAvailableShells,
  listPtySessions,
  removePtySession,
  updatePtySession,
} from './pty'

const pty = {
  id: 'pty-1',
  command: 'zsh',
  args: [],
  cwd: '/body-cwd',
  title: 'Terminal',
  env: {},
  status: 'running' as const,
  pid: 42,
}

describe('PTY SDK wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveServerIdMock.mockReturnValue('local')
    getServerBaseUrlMock.mockImplementation(serverID =>
      serverID === 'remote' ? 'https://terminal.example.test/api' : 'http://localhost:4096',
    )
    getSDKClientMock.mockReturnValue({ pty: ptyMock })
    ptyMock.connectToken.mockResolvedValue({ data: { ticket: 'ticket-1', expires_in: 30 } })
    ptyMock.create.mockResolvedValue({ data: pty })
    ptyMock.get.mockResolvedValue({ data: pty })
    ptyMock.list.mockResolvedValue({ data: [pty] })
    ptyMock.remove.mockResolvedValue({ data: true })
    ptyMock.shells.mockResolvedValue({ data: [{ path: '/bin/zsh', name: 'zsh', acceptable: true }] })
    ptyMock.update.mockResolvedValue({ data: pty })
  })

  it('keeps instance routing directory separate from the create body cwd', async () => {
    await createPtySession({ command: 'zsh', args: ['-l'], cwd: '/body-cwd' }, '/instance-workspace')

    expect(getSDKClientMock).toHaveBeenCalledWith({ serverID: 'local', directory: '/instance-workspace' })
    expect(ptyMock.create).toHaveBeenCalledWith({
      directory: '/instance-workspace',
      command: 'zsh',
      args: ['-l'],
      cwd: '/body-cwd',
    })
  })

  it('routes remote workspace operations by workspace ID', async () => {
    const scope = { serverID: 'remote', directory: '/same', workspace: 'workspace-a' }

    await expect(listPtySessions(scope)).resolves.toEqual([pty])
    await expect(listAvailableShells(scope)).resolves.toEqual([{ path: '/bin/zsh', name: 'zsh', acceptable: true }])
    await expect(getPtySession('pty-1', scope)).resolves.toEqual(pty)
    await expect(removePtySession('pty-1', scope)).resolves.toBe(true)

    expect(ptyMock.list).toHaveBeenCalledWith({ workspace: 'workspace-a' })
    expect(ptyMock.shells).toHaveBeenCalledWith({ workspace: 'workspace-a' })
    expect(ptyMock.get).toHaveBeenCalledWith({ ptyID: 'pty-1', workspace: 'workspace-a' })
    expect(ptyMock.remove).toHaveBeenCalledWith({ ptyID: 'pty-1', workspace: 'workspace-a' })
  })

  it('passes update dimensions in the SDK size body shape', async () => {
    await updatePtySession('pty-1', { size: { cols: 120, rows: 40 } }, '/instance-workspace')

    expect(ptyMock.update).toHaveBeenCalledWith({
      ptyID: 'pty-1',
      directory: '/instance-workspace',
      size: { cols: 120, rows: 40 },
    })
  })
})

describe('PTY connect URL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveServerIdMock.mockReturnValue('local')
    getServerBaseUrlMock.mockImplementation(serverID =>
      serverID === 'remote' ? 'https://terminal.example.test/api' : 'http://localhost:4096',
    )
    getSDKClientMock.mockReturnValue({ pty: ptyMock })
    ptyMock.connectToken.mockResolvedValue({ data: { ticket: 'ticket-1', expires_in: 30 } })
  })

  it.each([-1, 0, 17])('preserves cursor %s in a ticketed browser URL', async cursor => {
    const url = new URL(await getPtyConnectUrl('pty/id', '/instance workspace', { cursor }))

    expect(url.protocol).toBe('ws:')
    expect(url.pathname).toBe('/pty/pty%2Fid/connect')
    expect(url.searchParams.get('directory')).toBe('/instance workspace')
    expect(url.searchParams.get('cursor')).toBe(String(cursor))
    expect(url.searchParams.get('ticket')).toBe('ticket-1')
  })

  it('mints a scoped ticket and never exposes long-lived credentials in the browser URL', async () => {
    const scope = { serverID: 'remote', workspace: 'workspace-a' }
    const url = new URL(await getPtyConnectUrl('pty-1', scope, { cursor: 0 }))

    expect(ptyMock.connectToken).toHaveBeenCalledWith(
      { ptyID: 'pty-1', workspace: 'workspace-a' },
      { headers: { 'x-chimera-ticket': '1' } },
    )
    expect(url.protocol).toBe('wss:')
    expect(url.pathname).toBe('/api/pty/pty-1/connect')
    expect(url.searchParams.get('workspace')).toBe('workspace-a')
    expect(url.searchParams.get('ticket')).toBe('ticket-1')
    expect(url.searchParams.has('auth_token')).toBe(false)
    expect(url.username).toBe('')
    expect(url.password).toBe('')
  })

  it('keeps the header-capable bridge URL credential-free without minting a browser ticket', () => {
    getServerBaseUrlMock.mockReturnValue('https://terminal.example.test/api/')
    const url = new URL(buildPtyConnectUrl('pty-1', { serverID: 'remote', directory: '/workspace' }, { cursor: -1 }))

    expect(url.toString()).toBe('wss://terminal.example.test/api/pty/pty-1/connect?directory=%2Fworkspace&cursor=-1')
    expect(url.searchParams.has('ticket')).toBe(false)
    expect(ptyMock.connectToken).not.toHaveBeenCalled()
  })

  it('surfaces ticket mint failures instead of falling back to credential URLs', async () => {
    ptyMock.connectToken.mockResolvedValue({ error: new Error('ticket denied') })

    await expect(getPtyConnectUrl('pty-1', '/workspace')).rejects.toThrow('ticket denied')
  })

  it('rejects malformed ticket responses before opening a browser WebSocket', async () => {
    ptyMock.connectToken.mockResolvedValue({ data: { ticket: '', expires_in: 30 } })

    await expect(getPtyConnectUrl('pty-1', '/workspace')).rejects.toThrow(
      'PTY connect token response did not include a ticket',
    )
  })
})

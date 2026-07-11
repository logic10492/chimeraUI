import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveAuthMock, getActiveBaseUrlMock, ptyMock } = vi.hoisted(() => ({
  getActiveAuthMock: vi.fn<() => { username: string; password: string } | null>(() => null),
  getActiveBaseUrlMock: vi.fn(() => 'http://localhost:4096'),
  ptyMock: {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
    shells: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('./sdk', () => ({
  getSDKClient: () => ({ pty: ptyMock }),
  unwrap: <T>(result: { data?: T; error?: unknown }) => {
    if (result.error) throw result.error
    return result.data as T
  },
}))

vi.mock('../store/serverStore', () => ({
  makeBasicAuthHeader: vi.fn(() => 'Basic header-token'),
  serverStore: {
    getActiveAuth: getActiveAuthMock,
    getActiveBaseUrl: getActiveBaseUrlMock,
  },
}))

import {
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
    getActiveAuthMock.mockReturnValue(null)
    getActiveBaseUrlMock.mockReturnValue('http://localhost:4096')
    ptyMock.create.mockResolvedValue({ data: pty })
    ptyMock.get.mockResolvedValue({ data: pty })
    ptyMock.list.mockResolvedValue({ data: [pty] })
    ptyMock.remove.mockResolvedValue({ data: true })
    ptyMock.shells.mockResolvedValue({ data: [{ path: '/bin/zsh', name: 'zsh', acceptable: true }] })
    ptyMock.update.mockResolvedValue({ data: pty })
  })

  it('keeps instance routing directory separate from the create body cwd', async () => {
    await createPtySession({ command: 'zsh', args: ['-l'], cwd: '/body-cwd' }, '/instance-workspace')

    expect(ptyMock.create).toHaveBeenCalledWith({
      directory: '/instance-workspace',
      command: 'zsh',
      args: ['-l'],
      cwd: '/body-cwd',
    })
  })

  it('passes update dimensions in the SDK size body shape', async () => {
    await updatePtySession('pty-1', { size: { cols: 120, rows: 40 } }, '/instance-workspace')

    expect(ptyMock.update).toHaveBeenCalledWith({
      ptyID: 'pty-1',
      directory: '/instance-workspace',
      size: { cols: 120, rows: 40 },
    })
  })

  it('maps list, shells, get, and remove through the current SDK contract', async () => {
    await expect(listPtySessions('/instance-workspace')).resolves.toEqual([pty])
    await expect(listAvailableShells('/instance-workspace')).resolves.toEqual([
      { path: '/bin/zsh', name: 'zsh', acceptable: true },
    ])
    await expect(getPtySession('pty-1', '/instance-workspace')).resolves.toEqual(pty)
    await expect(removePtySession('pty-1', '/instance-workspace')).resolves.toBe(true)

    expect(ptyMock.list).toHaveBeenCalledWith({ directory: '/instance-workspace' })
    expect(ptyMock.shells).toHaveBeenCalledWith({ directory: '/instance-workspace' })
    expect(ptyMock.get).toHaveBeenCalledWith({ ptyID: 'pty-1', directory: '/instance-workspace' })
    expect(ptyMock.remove).toHaveBeenCalledWith({ ptyID: 'pty-1', directory: '/instance-workspace' })
  })
})

describe('browser PTY connect URL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveAuthMock.mockReturnValue(null)
    getActiveBaseUrlMock.mockReturnValue('http://localhost:4096')
  })

  it.each([-1, 0, 17])('preserves cursor %s in the query', cursor => {
    expect(getPtyConnectUrl('pty/id', '/instance workspace', { cursor })).toBe(
      `ws://localhost:4096/pty/pty/id/connect?directory=%2Finstance%20workspace&cursor=${cursor}`,
    )
  })

  it('maps cross-origin browser auth to auth_token and userinfo', () => {
    getActiveBaseUrlMock.mockReturnValue('https://terminal.example.test/api')
    getActiveAuthMock.mockReturnValue({ username: 'user name', password: 'p@ss word' })

    const url = new URL(getPtyConnectUrl('pty-1', '/workspace', { cursor: 0 }))

    expect(url.protocol).toBe('wss:')
    expect(url.username).toBe('user%20name')
    expect(url.password).toBe('p%40ss%20word')
    expect(url.pathname).toBe('/api/pty/pty-1/connect')
    expect(url.searchParams.get('directory')).toBe('/workspace')
    expect(url.searchParams.get('cursor')).toBe('0')
    expect(url.searchParams.get('auth_token')).toBe(btoa('user name:p@ss word'))
  })

  it('omits browser auth from the URL when requested by a header-capable transport', () => {
    getActiveBaseUrlMock.mockReturnValue('https://terminal.example.test')
    getActiveAuthMock.mockReturnValue({ username: 'chimera', password: 'secret' })

    expect(getPtyConnectUrl('pty-1', '/workspace', { includeAuthInUrl: false, cursor: -1 })).toBe(
      'wss://terminal.example.test/pty/pty-1/connect?directory=%2Fworkspace&cursor=-1',
    )
  })
})

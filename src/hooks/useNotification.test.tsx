// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tauri: false,
  actionHandler: undefined as ((value: { extra?: Record<string, unknown> }) => void) | undefined,
  register: vi.fn(),
  sendNotification: vi.fn(),
  setActiveServer: vi.fn(() => true),
  show: vi.fn(),
  setFocus: vi.fn(),
}))

vi.mock('../utils/tauri', () => ({ isTauri: () => mocks.tauri }))
vi.mock('../store/serverStore', () => ({
  serverStore: {
    getServers: () => [{ id: 'configured' }],
    setActiveServer: mocks.setActiveServer,
  },
}))
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => 'granted'),
  sendNotification: mocks.sendNotification,
  onAction: vi.fn(async (handler: typeof mocks.actionHandler) => {
    mocks.actionHandler = handler
    return { unregister: vi.fn() }
  }),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ show: mocks.show, setFocus: mocks.setFocus }),
}))

import {
  NATIVE_NOTIFICATION_SCHEMA_VERSION,
  buildNotificationSessionHash,
  buildNotificationAssetURL,
  installNativeNotificationActionHandler,
  parseNativeNotificationExtra,
  registerNotificationServiceWorker,
  sendTauriNotification,
} from './useNotification'

describe('notification platform contracts', () => {
  beforeEach(() => {
    mocks.tauri = false
    mocks.actionHandler = undefined
    mocks.register.mockReset()
    mocks.sendNotification.mockReset()
    mocks.setActiveServer.mockClear()
    mocks.show.mockClear()
    mocks.setFocus.mockClear()
    window.location.hash = ''
  })

  it('registers the notification worker at the configured base scope', async () => {
    mocks.register.mockResolvedValue({ scope: '/' })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: mocks.register },
    })

    await registerNotificationServiceWorker()

    expect(mocks.register).toHaveBeenCalledWith(new URL('/notification-sw.js', window.location.origin), { scope: '/' })
  })

  it('encodes notification navigation values', () => {
    expect(buildNotificationSessionHash({ sessionID: 'session/id', directory: '/tmp/a b' })).toBe(
      '#/session/session%2Fid?dir=%2Ftmp%2Fa%20b',
    )
  })

  it('resolves notification assets inside the configured base path', () => {
    expect(buildNotificationAssetURL('opencode.svg', '/chimera/')).toBe(
      `${window.location.origin}/chimera/opencode.svg`,
    )
  })

  it('sends the versioned native notification extra', async () => {
    mocks.tauri = true
    await sendTauriNotification('Done', 'Completed', {
      serverID: 'configured',
      directory: '/tmp/project',
      sessionID: 'session-1',
    })

    expect(mocks.sendNotification).toHaveBeenCalledWith({
      title: 'Done',
      body: 'Completed',
      extra: {
        schemaVersion: NATIVE_NOTIFICATION_SCHEMA_VERSION,
        serverID: 'configured',
        directory: '/tmp/project',
        sessionID: 'session-1',
      },
    })
  })

  it('validates native action payloads and navigates only configured servers', async () => {
    expect(
      parseNativeNotificationExtra({ schemaVersion: 99, serverID: 'configured', sessionID: 'session-1' }),
    ).toBeNull()
    mocks.tauri = true
    await installNativeNotificationActionHandler()

    mocks.actionHandler?.({
      extra: {
        schemaVersion: NATIVE_NOTIFICATION_SCHEMA_VERSION,
        serverID: 'missing',
        sessionID: 'ignored',
      },
    })
    expect(mocks.setActiveServer).not.toHaveBeenCalled()

    mocks.actionHandler?.({
      extra: {
        schemaVersion: NATIVE_NOTIFICATION_SCHEMA_VERSION,
        serverID: 'configured',
        directory: '/tmp/a b',
        sessionID: 'session/id',
      },
    })

    expect(mocks.show).toHaveBeenCalledOnce()
    expect(mocks.setFocus).toHaveBeenCalledOnce()
    expect(mocks.setActiveServer).toHaveBeenCalledWith('configured')
    expect(window.location.hash).toBe('#/session/session%2Fid?dir=%2Ftmp%2Fa%20b')
  })
})

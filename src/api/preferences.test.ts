import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebUIPreferencesSnapshot } from '../types/api/preferences'
import {
  getWebUIPreferences,
  updateWebUIPreferences,
  WebUIPreferencesRevisionConflictError,
} from './preferences'

const { client, getSDKClientMock } = vi.hoisted(() => {
  const client = {
    global: {
      preferences: {
        get: vi.fn(),
        update: vi.fn(),
      },
    },
  }
  return { client, getSDKClientMock: vi.fn(() => client) }
})

vi.mock('./sdk', () => ({
  getSDKClient: getSDKClientMock,
  unwrap: <T>(result: { data?: T; error?: unknown }) => {
    if (result.error) throw result.error
    return result.data as T
  },
}))

const snapshot: WebUIPreferencesSnapshot = {
  schemaVersion: 1,
  revision: 2,
  initialized: true,
  preferences: { appearance: { colorMode: 'dark' } },
}

describe('WebUI preferences API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the server-scoped generated SDK operations', async () => {
    client.global.preferences.get.mockResolvedValue({ data: snapshot })
    client.global.preferences.update.mockResolvedValue({ data: snapshot })

    await expect(getWebUIPreferences('server-a')).resolves.toEqual(snapshot)
    await expect(
      updateWebUIPreferences({ revision: 1, preferences: { appearance: { colorMode: 'dark' } } }, 'server-a'),
    ).resolves.toEqual(snapshot)

    expect(getSDKClientMock).toHaveBeenNthCalledWith(1, { serverID: 'server-a' })
    expect(getSDKClientMock).toHaveBeenNthCalledWith(2, { serverID: 'server-a' })
    expect(client.global.preferences.get).toHaveBeenCalledWith()
    expect(client.global.preferences.update).toHaveBeenCalledWith({
      webUiPreferencesUpdate: {
        revision: 1,
        preferences: { appearance: { colorMode: 'dark' } },
      },
    })
  })

  it('raises a structured conflict error for 409 responses', async () => {
    client.global.preferences.update.mockResolvedValue({
      error: {
        name: 'WebUIPreferencesRevisionConflictError',
        data: { expectedRevision: 1, actualRevision: 2 },
      },
      response: { status: 409 },
    })

    const error = await updateWebUIPreferences({ revision: 1, preferences: {} }, 'server-a').catch(value => value)
    expect(error).toBeInstanceOf(WebUIPreferencesRevisionConflictError)
    expect(error.data).toEqual({ expectedRevision: 1, actualRevision: 2 })
  })
})

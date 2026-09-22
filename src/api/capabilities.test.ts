import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
}))

vi.mock('./config', () => ({
  getConfig: getConfigMock,
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    getActiveServerId: () => 'local',
    onServerChange: () => () => {},
  },
}))

import { getServerCapabilities, invalidateServerCapabilities } from './capabilities'

describe('getServerCapabilities', () => {
  beforeEach(() => {
    getConfigMock.mockReset()
    invalidateServerCapabilities()
  })

  it('treats a missing delegation.background_subagents as enabled (server default)', async () => {
    getConfigMock.mockResolvedValue({})
    await expect(getServerCapabilities()).resolves.toEqual({ backgroundSubagents: true })
  })

  it('reports backgroundSubagents false when the kill-switch is off', async () => {
    getConfigMock.mockResolvedValue({ delegation: { background_subagents: false } })
    await expect(getServerCapabilities()).resolves.toEqual({ backgroundSubagents: false })
  })

  it('fails closed when the config fetch errors', async () => {
    getConfigMock.mockRejectedValue(new Error('server gone'))
    await expect(getServerCapabilities()).resolves.toEqual({ backgroundSubagents: false })
  })

  it('caches per scope and re-resolves after invalidate', async () => {
    getConfigMock.mockResolvedValue({})
    await getServerCapabilities()
    await getServerCapabilities()
    expect(getConfigMock).toHaveBeenCalledTimes(1)
    invalidateServerCapabilities()
    await getServerCapabilities()
    expect(getConfigMock).toHaveBeenCalledTimes(2)
  })
})

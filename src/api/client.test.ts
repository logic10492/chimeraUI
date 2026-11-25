import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getActiveModels } from './client'

const { providersMock } = vi.hoisted(() => ({
  providersMock: vi.fn(),
}))

vi.mock('./sdk', () => ({
  getSDKClient: () => ({ config: { providers: providersMock } }),
  unwrap: (result: { data: unknown }) => result.data,
}))

vi.mock('../utils/directoryUtils', () => ({
  formatPathForApi: (directory?: string) => directory,
}))

function model(id: string, status?: string) {
  return {
    id,
    name: id,
    ...(status === undefined ? {} : { status }),
    limit: { context: 128000, output: 4096 },
    capabilities: {},
    variants: {},
  }
}

describe('getActiveModels', () => {
  beforeEach(() => {
    providersMock.mockReset()
    providersMock.mockResolvedValue({
      data: {
        providers: [
          {
            id: 'ali-inc',
            name: 'Ali',
            models: {
              active: model('active', 'active'),
              beta: model('beta', 'beta'),
              alpha: model('alpha', 'alpha'),
              deprecated: model('deprecated', 'deprecated'),
              missing: model('missing'),
            },
          },
        ],
        default: {},
      },
    })
  })

  it('keeps the default active-only filtering and excludes deprecated models', async () => {
    const models = await getActiveModels()

    expect(models.map(item => item.id)).toEqual(['active', 'missing'])
    expect(providersMock).toHaveBeenCalledWith({ directory: undefined, include_experimental: undefined })
  })

  it('includes alpha and beta models only when prerelease support is enabled', async () => {
    const models = await getActiveModels(undefined, true)

    expect(models.map(item => item.id)).toEqual(['active', 'beta', 'alpha', 'missing'])
    expect(providersMock).toHaveBeenCalledWith({ directory: undefined, include_experimental: 'true' })
  })
})

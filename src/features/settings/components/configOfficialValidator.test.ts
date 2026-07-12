import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../utils/tauri', () => ({ isTauri: () => false }))

describe('official config schema validation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports upstream schema network failures as unavailable without config errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const { validateAgainstOfficialConfigSchema } = await import('./configOfficialValidator')

    await expect(validateAgainstOfficialConfigSchema({ provider: { chimera: {} } })).resolves.toEqual({
      errors: [],
      unavailable: 'offline',
    })
  })
})

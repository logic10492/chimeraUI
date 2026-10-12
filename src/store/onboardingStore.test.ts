import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingStore } from './onboardingStore'

const { listProvidersMock } = vi.hoisted(() => ({ listProvidersMock: vi.fn() }))

vi.mock('../api/provider', () => ({ listProviders: listProvidersMock }))

function provider(id: string, options: Record<string, unknown> = {}) {
  return { id, name: id, source: 'api', options, models: { model: {} } }
}

function providersResponse(all: ReturnType<typeof provider>[], connected: string[]) {
  return { all, connected, default: {} }
}

// The built-in free OpenCode Zen provider is always "connected" on a fresh
// install (id "opencode" + options.apiKey "public"); it must not satisfy onboarding.
const builtinFree = () => ({
  id: 'opencode',
  name: 'OpenCode Zen',
  source: 'custom',
  options: { apiKey: 'public' },
  models: { free: {} },
})

afterEach(() => {
  localStorage.clear()
  listProvidersMock.mockReset()
})

beforeEach(() => {
  localStorage.clear()
})

describe('OnboardingStore state machine', () => {
  it('opens provider onboarding when only the built-in free provider is connected', async () => {
    listProvidersMock.mockResolvedValue(providersResponse([builtinFree()], ['opencode']))

    const store = new OnboardingStore()
    await store.check('/project')

    expect(listProvidersMock).toHaveBeenCalledWith('/project')
    expect(store.getSnapshot().status).toBe('needs-provider')
    expect(store.getSnapshot().connectedCount).toBe(0)
  })

  it('stays ready and does not open onboarding when a user provider is connected', async () => {
    listProvidersMock.mockResolvedValue(
      providersResponse([builtinFree(), provider('anthropic')], ['opencode', 'anthropic']),
    )

    const store = new OnboardingStore()
    await store.check('/project')

    expect(store.getSnapshot().status).toBe('ready')
    expect(store.getSnapshot().connectedCount).toBe(1)
  })

  it('advances to model guidance after a provider connects during onboarding', async () => {
    listProvidersMock.mockResolvedValue(providersResponse([builtinFree()], ['opencode']))

    const store = new OnboardingStore()
    await store.check('/project')
    expect(store.getSnapshot().status).toBe('needs-provider')

    store.notifyProviderConnected()
    expect(store.getSnapshot().status).toBe('needs-model')
    expect(store.getSnapshot().connectedCount).toBe(1)
  })

  it('ignores connect signals outside the onboarding flow', async () => {
    listProvidersMock.mockResolvedValue(
      providersResponse([builtinFree(), provider('anthropic')], ['opencode', 'anthropic']),
    )

    const store = new OnboardingStore()
    await store.check('/project')
    expect(store.getSnapshot().status).toBe('ready')

    store.notifyProviderConnected()
    expect(store.getSnapshot().status).toBe('ready')
  })

  it('persists skip per server and never re-opens onboarding afterwards', async () => {
    listProvidersMock.mockResolvedValue(providersResponse([builtinFree()], ['opencode']))

    const store = new OnboardingStore()
    await store.check('/project')
    expect(store.getSnapshot().status).toBe('needs-provider')

    store.skip()
    expect(store.getSnapshot().status).toBe('ready')
    expect(store.getSnapshot().skipped).toBe(true)

    // A fresh store (e.g. next app launch) reads the persisted dismissal.
    const nextLaunch = new OnboardingStore()
    await nextLaunch.check('/project')
    expect(nextLaunch.getSnapshot().status).toBe('ready')
    expect(nextLaunch.getSnapshot().skipped).toBe(true)
  })

  it('degrades to ready when provider detection fails instead of trapping the user', async () => {
    listProvidersMock.mockRejectedValue(new Error('network down'))

    const store = new OnboardingStore()
    await store.check(undefined)

    expect(store.getSnapshot().status).toBe('ready')
  })
})

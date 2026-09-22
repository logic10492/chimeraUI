import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelInfo } from '../api'

const { getActiveModelsMock, getSDKClientAsyncMock, onServerChangeMock } = vi.hoisted(() => ({
  getActiveModelsMock: vi.fn(),
  getSDKClientAsyncMock: vi.fn(),
  onServerChangeMock: vi.fn(() => () => {}),
}))

vi.mock('../api', () => ({
  getActiveModels: getActiveModelsMock,
}))

vi.mock('../api/sdk', () => ({
  getSDKClientAsync: getSDKClientAsyncMock,
}))

vi.mock('../store/serverStore', () => ({
  serverStore: {
    onServerChange: onServerChangeMock,
  },
}))

const MODEL: ModelInfo = {
  id: 'gpt-4.1',
  name: 'GPT-4.1',
  providerId: 'openai',
  providerName: 'OpenAI',
  family: 'gpt',
  contextLimit: 128000,
  outputLimit: 32000,
  supportsReasoning: true,
  supportsImages: true,
  supportsPdf: true,
  supportsAudio: false,
  supportsVideo: false,
  supportsToolcall: true,
  variants: [],
}

async function loadUseModels() {
  let mod!: typeof import('./useModels')
  await act(async () => {
    mod = await import('./useModels')
  })
  return mod
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useModels bounded retry', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    getActiveModelsMock.mockReset()
    getSDKClientAsyncMock.mockReset()
    getSDKClientAsyncMock.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries once after backoff when the initial fetch fails, then recovers', async () => {
    getActiveModelsMock.mockRejectedValueOnce(new Error('server warming up')).mockResolvedValueOnce([MODEL])

    const mod = await loadUseModels()
    const { result } = renderHook(() => mod.useModels())

    expect(result.current.error?.message).toBe('server warming up')
    expect(result.current.isLoading).toBe(false)
    expect(getActiveModelsMock).toHaveBeenCalledTimes(1)

    await advance(1500)

    expect(getActiveModelsMock).toHaveBeenCalledTimes(2)
    expect(result.current.models).toEqual([MODEL])
    expect(result.current.error).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('retries once after backoff when the initial fetch returns an empty list', async () => {
    getActiveModelsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([MODEL])

    const mod = await loadUseModels()
    const { result } = renderHook(() => mod.useModels())

    expect(result.current.models).toEqual([])
    expect(result.current.error).toBeNull()

    await advance(1500)

    expect(getActiveModelsMock).toHaveBeenCalledTimes(2)
    expect(result.current.models).toEqual([MODEL])
  })

  it('does not retry more than once when every attempt fails', async () => {
    getActiveModelsMock.mockRejectedValue(new Error('still down'))

    const mod = await loadUseModels()
    const { result } = renderHook(() => mod.useModels())

    await advance(1500)
    await advance(5000)

    expect(getActiveModelsMock).toHaveBeenCalledTimes(2)
    expect(result.current.error?.message).toBe('still down')
    expect(result.current.isLoading).toBe(false)
  })
})

import { useSyncExternalStore, useCallback } from 'react'
import { getActiveModels, type ModelInfo } from '../api'
import { getSDKClientAsync } from '../api/sdk'
import { serverStore } from '../store/serverStore'

// ============================================
// Global singleton so every ChatPane shares one models array.
// Prevents duplicate API requests and the race condition where a
// late-mounting pane sees an empty models list, falls back to
// models[0], and overwrites the persisted model selection.
// ============================================

interface ModelsState {
  models: ModelInfo[]
  isLoading: boolean
  error: Error | null
}

type Listener = () => void

let _state: ModelsState = { models: [], isLoading: true, error: null }
let _fetchPromise: Promise<void> | null = null
let _fetchGeneration = 0
const _listeners = new Set<Listener>()

function _notify() {
  for (const fn of _listeners) fn()
}

function _setState(patch: Partial<ModelsState>) {
  _state = { ..._state, ...patch }
  _notify()
}

// Bounded retry: after a host restart the provider surface can be empty or
// erroring for a short warmup window. Retry once after a short backoff when
// the fetch fails or returns zero models; single-flight dedupe still applies.
const RETRY_DELAY_MS = 1500
let _retryTimer: ReturnType<typeof setTimeout> | null = null

function _scheduleRetry() {
  if (_retryTimer) clearTimeout(_retryTimer)
  _retryTimer = setTimeout(() => {
    _retryTimer = null
    void _fetchModels(true, true)
  }, RETRY_DELAY_MS)
}

async function _fetchModels(force = false, isRetry = false) {
  if (_fetchPromise && !force) return _fetchPromise

  const generation = ++_fetchGeneration

  _fetchPromise = (async () => {
    _setState({ isLoading: true, error: null })
    try {
      await getSDKClientAsync()
      const data = await getActiveModels()
      if (generation === _fetchGeneration) {
        _setState({ models: data, isLoading: false })
        if (data.length === 0 && !isRetry) _scheduleRetry()
      }
    } catch (e) {
      if (generation === _fetchGeneration) {
        _setState({ error: e instanceof Error ? e : new Error('Failed to fetch models'), isLoading: false })
        if (!isRetry) _scheduleRetry()
      }
    } finally {
      if (generation === _fetchGeneration) {
        _fetchPromise = null
      }
    }
  })()

  return _fetchPromise
}

export function refreshModels() {
  if (_retryTimer) {
    clearTimeout(_retryTimer)
    _retryTimer = null
  }
  return _fetchModels(true)
}

// First fetch on module load — models are ready before any component mounts.
_fetchModels()

serverStore.onServerChange(() => {
  void refreshModels()
})

function _subscribe(listener: Listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

function _getSnapshot(): ModelsState {
  return _state
}

// ============================================
// Hook — drop-in replacement, same return type
// ============================================

interface UseModelsResult {
  models: ModelInfo[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useModels(): UseModelsResult {
  const state = useSyncExternalStore(_subscribe, _getSnapshot)
  const refetch = useCallback(() => refreshModels(), [])

  return {
    models: state.models,
    isLoading: state.isLoading,
    error: state.error,
    refetch,
  }
}

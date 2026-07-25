import { afterEach, describe, expect, it, vi } from 'vitest'
import { paneControllerStore, type PaneControllerState } from './paneControllerStore'

const actions = {
  newSession: vi.fn(),
  archiveSession: vi.fn(),
  previousSession: vi.fn(),
  nextSession: vi.fn(),
  toggleAgent: vi.fn(),
  copyLastResponse: vi.fn(),
  cancelMessage: vi.fn(),
  openModelSelector: vi.fn(),
  toggleFullAuto: vi.fn(),
}

function controller(currentModelId?: string): PaneControllerState {
  return {
    paneId: 'pane-stage-4',
    sessionId: 'session-1',
    effectiveDirectory: '/workspace',
    currentProviderId: 'openai',
    currentModelId,
    isStreaming: false,
    ...actions,
  }
}

afterEach(() => paneControllerStore.removeController('pane-stage-4'))

describe('paneControllerStore', () => {
  it('publishes a new snapshot when only currentModelId changes', () => {
    paneControllerStore.setController('pane-stage-4', controller('gpt-5'))
    const snapshot = paneControllerStore.getControllers()
    const listener = vi.fn()
    const unsubscribe = paneControllerStore.subscribe(listener)

    paneControllerStore.setController('pane-stage-4', controller('gpt-5.1'))

    expect(listener).toHaveBeenCalledOnce()
    expect(paneControllerStore.getControllers()).not.toBe(snapshot)
    expect(paneControllerStore.getController('pane-stage-4')?.currentModelId).toBe('gpt-5.1')
    unsubscribe()
  })
})

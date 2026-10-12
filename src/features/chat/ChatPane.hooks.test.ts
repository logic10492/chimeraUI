import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useModelAgentRestore } from './ChatPane.hooks'
import type { ModelInfo } from '../../types/ui'
import type { Message } from '../../types/message'
import type { RevertHistoryItem } from '../../store/messageStoreTypes'

const model: ModelInfo = {
  id: 'm1',
  name: 'Model 1',
  providerId: 'p1',
  providerName: 'Provider 1',
  family: 'test',
  contextLimit: 1000,
  outputLimit: 100,
  supportsReasoning: false,
  supportsImages: false,
  supportsPdf: false,
  supportsAudio: false,
  supportsVideo: false,
  supportsToolcall: true,
  variants: [],
}

function userMessage(info: Record<string, unknown>): Message {
  return { info: { role: 'user', ...info }, parts: [] } as unknown as Message
}

describe('useModelAgentRestore', () => {
  it('restores the model immediately from revert/undo content', () => {
    const restoreFromMessage = vi.fn()
    const inputRestoreContent: RevertHistoryItem = {
      messageId: 'msg-1',
      text: 'draft',
      attachments: [],
      model: { providerID: 'p1', modelID: 'm1' },
    }

    renderHook(() =>
      useModelAgentRestore({
        inputRestoreContent,
        visibleModels: [model],
        restoreFromMessage,
        routeSessionId: null,
        messages: [],
        sessionModel: null,
        restoreAgentFromMessage: vi.fn(),
      }),
    )

    expect(restoreFromMessage).toHaveBeenCalledWith({ providerID: 'p1', modelID: 'm1' }, undefined)
  })

  it('restores the model from the last user message on session switch', () => {
    const restoreFromMessage = vi.fn()

    renderHook(() =>
      useModelAgentRestore({
        inputRestoreContent: null,
        visibleModels: [model],
        restoreFromMessage,
        routeSessionId: 's1',
        messages: [userMessage({ model: { providerID: 'p1', modelID: 'm1' } })],
        sessionModel: null,
        restoreAgentFromMessage: vi.fn(),
      }),
    )

    expect(restoreFromMessage).toHaveBeenCalledWith({ providerID: 'p1', modelID: 'm1' }, undefined)
  })

  it('prefers the session model and skips user-message restore', () => {
    const restoreFromMessage = vi.fn()

    renderHook(() =>
      useModelAgentRestore({
        inputRestoreContent: null,
        visibleModels: [model],
        restoreFromMessage,
        routeSessionId: 's1',
        messages: [userMessage({ model: { providerID: 'p1', modelID: 'm1' } })],
        sessionModel: { providerID: 'p1', modelID: 'm1' },
        restoreAgentFromMessage: vi.fn(),
      }),
    )

    expect(restoreFromMessage).not.toHaveBeenCalled()
  })

  it('restores the agent from revert/undo content', () => {
    const restoreAgentFromMessage = vi.fn()
    const inputRestoreContent: RevertHistoryItem = {
      messageId: 'msg-1',
      text: 'draft',
      attachments: [],
      agent: 'build',
    }

    renderHook(() =>
      useModelAgentRestore({
        inputRestoreContent,
        visibleModels: [],
        restoreFromMessage: vi.fn(),
        routeSessionId: null,
        messages: [],
        sessionModel: null,
        restoreAgentFromMessage,
      }),
    )

    expect(restoreAgentFromMessage).toHaveBeenCalledWith('build')
  })

  it('restores the agent from the last user message', () => {
    const restoreAgentFromMessage = vi.fn()

    renderHook(() =>
      useModelAgentRestore({
        inputRestoreContent: null,
        visibleModels: [],
        restoreFromMessage: vi.fn(),
        routeSessionId: 's1',
        messages: [userMessage({ agent: 'plan' })],
        sessionModel: null,
        restoreAgentFromMessage,
      }),
    )

    expect(restoreAgentFromMessage).toHaveBeenCalledWith('plan')
  })
})
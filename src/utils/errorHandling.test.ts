import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logError } from './errorHandling'

const { pushTransientMock } = vi.hoisted(() => ({
  pushTransientMock: vi.fn(),
}))

vi.mock('../store/notificationStore', () => ({
  notificationStore: {
    pushTransient: pushTransientMock,
  },
}))

describe('logError', () => {
  beforeEach(() => {
    pushTransientMock.mockClear()
  })

  it('shows safe feedback for non-silent errors', () => {
    logError(new Error('secret details'), { category: 'api', operation: 'Loading session' })

    expect(pushTransientMock).toHaveBeenCalledWith('error', 'Error', 'Loading session failed')
  })

  it('does not show feedback for silent errors', () => {
    logError(new Error('ignored'), { category: 'api', operation: 'Polling', silent: true })

    expect(pushTransientMock).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSingleFlight, singleFlight, singleFlightKey } from './singleFlight'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('singleFlight', () => {
  beforeEach(() => {
    clearSingleFlight()
  })

  it('shares one in-flight promise between concurrent callers', async () => {
    const deferred = createDeferred<string>()
    const factory = vi.fn(() => deferred.promise)

    const first = singleFlight('key-a', factory)
    const second = singleFlight('key-a', factory)

    expect(factory).toHaveBeenCalledTimes(1)

    deferred.resolve('value')

    await expect(first).resolves.toBe('value')
    await expect(second).resolves.toBe('value')
  })

  it('issues a new request after the shared one settles', async () => {
    const factory = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')

    await expect(singleFlight('key-b', factory)).resolves.toBe('first')
    await expect(singleFlight('key-b', factory)).resolves.toBe('second')
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('shares failures with joiners and clears the entry afterwards', async () => {
    const error = new Error('boom')
    const failing = singleFlight('key-c', () => Promise.reject(error))
    const joined = singleFlight('key-c', () => Promise.resolve('unused'))

    await expect(failing).rejects.toBe(error)
    await expect(joined).rejects.toBe(error)
    await expect(singleFlight('key-c', () => Promise.resolve('fresh'))).resolves.toBe('fresh')
  })

  it('keeps different keys isolated', async () => {
    const factory = vi.fn().mockResolvedValue('value')

    await Promise.all([singleFlight('key-d', factory), singleFlight('key-e', factory)])

    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('builds stable keys regardless of object key order and undefined fields', () => {
    expect(singleFlightKey('kind', { a: 1, b: 2 })).toBe(singleFlightKey('kind', { b: 2, a: 1 }))
    expect(singleFlightKey('kind', { a: 1, b: undefined })).toBe(singleFlightKey('kind', { a: 1 }))
    expect(singleFlightKey('kind', { a: 1 })).not.toBe(singleFlightKey('kind', { a: 2 }))
  })
})

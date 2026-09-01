import { describe, expect, it } from 'vitest'
import { scheduleRequest } from './requestQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('requestQueue', () => {
  it('limits concurrent executions and drains the queue as slots free up', async () => {
    const started: number[] = []
    const gates = Array.from({ length: 6 }, () => deferred<string>())
    const tasks = gates.map((gate, index) =>
      scheduleRequest(() => {
        started.push(index)
        return gate.promise
      }),
    )

    expect(started).toEqual([0, 1, 2, 3])

    gates[0].resolve('a')
    await tasks[0]
    await flush()
    expect(started).toEqual([0, 1, 2, 3, 4])

    gates.slice(1).forEach(gate => gate.resolve('x'))
    await Promise.all(tasks)
    expect(started).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('runs interactive tasks before queued background tasks', async () => {
    const started: string[] = []
    const gates = Array.from({ length: 4 }, () => deferred<void>())
    const inflight = gates.map(gate =>
      scheduleRequest(() => {
        started.push('busy')
        return gate.promise
      }),
    )
    const background = [
      scheduleRequest(() => {
        started.push('background-1')
        return Promise.resolve()
      }),
      scheduleRequest(() => {
        started.push('background-2')
        return Promise.resolve()
      }),
    ]
    const interactive = scheduleRequest(
      () => {
        started.push('interactive')
        return Promise.resolve()
      },
      { priority: 'interactive' },
    )

    expect(started).toEqual(['busy', 'busy', 'busy', 'busy'])

    gates[0].resolve()
    await flush()
    expect(started).toContain('interactive')
    expect(started.indexOf('interactive')).toBeLessThan(started.indexOf('background-1'))
    expect(started.indexOf('interactive')).toBeLessThan(started.indexOf('background-2'))

    gates.slice(1).forEach(gate => gate.resolve())
    await Promise.all([...inflight, ...background, interactive])
  })

  it('rejects queued tasks on abort without consuming a slot', async () => {
    const gates = Array.from({ length: 4 }, () => deferred<void>())
    const inflight = gates.map(gate => scheduleRequest(() => gate.promise))

    const controller = new AbortController()
    const queued = scheduleRequest(() => Promise.resolve('never'), { signal: controller.signal })
    const expectation = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await expectation

    gates.forEach(gate => gate.resolve())
    await Promise.all(inflight)

    let ran = false
    await scheduleRequest(() => {
      ran = true
      return Promise.resolve()
    })
    expect(ran).toBe(true)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    let ran = false
    await expect(
      scheduleRequest(
        () => {
          ran = true
          return Promise.resolve()
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(ran).toBe(false)
  })

  it('propagates execution errors and frees the slot', async () => {
    await expect(scheduleRequest(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')

    let ran = false
    await scheduleRequest(() => {
      ran = true
      return Promise.resolve()
    })
    expect(ran).toBe(true)
  })
})

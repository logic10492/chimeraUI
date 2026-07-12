import { describe, expect, it } from 'vitest'
import { ByteLruCache } from './filePreviewCache'

describe('ByteLruCache', () => {
  it('accounts for UTF-8 bytes and evicts the oldest entry to stay within budget', () => {
    const cache = new ByteLruCache<string, string>(5, value => value)

    cache.set('ascii', 'abc')
    cache.set('unicode', 'é')
    expect(cache.byteSize).toBe(5)

    cache.set('next', 'x')

    expect(cache.get('ascii')).toBeUndefined()
    expect(cache.get('unicode')).toBe('é')
    expect(cache.get('next')).toBe('x')
    expect(cache.byteSize).toBe(3)
  })

  it('promotes entries on get before evicting', () => {
    const cache = new ByteLruCache<string, string>(3, value => value)

    cache.set('first', 'a')
    cache.set('second', 'b')
    cache.set('third', 'c')
    cache.get('first')
    cache.set('fourth', 'd')

    expect(cache.get('second')).toBeUndefined()
    expect(cache.get('first')).toBe('a')
  })

  it('updates byte accounting when entries are replaced, deleted, and cleared', () => {
    const cache = new ByteLruCache<string, string>(10, value => value)

    cache.set('value', 'abc')
    cache.set('value', 'é')
    expect(cache.byteSize).toBe(2)

    expect(cache.delete('value')).toBe(true)
    expect(cache.byteSize).toBe(0)

    cache.set('one', '1')
    cache.set('two', '22')
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.byteSize).toBe(0)
  })

  it('does not retain entries larger than the byte budget', () => {
    const cache = new ByteLruCache<string, string>(2, value => value)

    expect(cache.set('large', 'abc')).toBe(false)
    expect(cache.get('large')).toBeUndefined()
    expect(cache.size).toBe(0)
    expect(cache.byteSize).toBe(0)
  })
})

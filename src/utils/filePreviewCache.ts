const encoder = new TextEncoder()

interface CacheEntry<T> {
  value: T
  bytes: number
}

export const FILE_PREVIEW_CACHE_MAX_BYTES = 8 * 1024 * 1024

export class ByteLruCache<K, V> {
  private entries = new Map<K, CacheEntry<V>>()
  private usedBytes = 0
  private readonly maxBytes: number
  private readonly serialize: (value: V) => string

  constructor(maxBytes: number, serialize: (value: V) => string) {
    this.maxBytes = maxBytes
    this.serialize = serialize
  }

  get size() {
    return this.entries.size
  }

  get byteSize() {
    return this.usedBytes
  }

  get(key: K) {
    const entry = this.entries.get(key)
    if (!entry) return undefined

    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V) {
    this.delete(key)

    const bytes = encoder.encode(this.serialize(value)).byteLength
    if (bytes > this.maxBytes) return false

    this.entries.set(key, { value, bytes })
    this.usedBytes += bytes

    while (this.usedBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) break
      this.delete(oldestKey)
    }

    return true
  }

  delete(key: K) {
    const entry = this.entries.get(key)
    if (!entry) return false

    this.entries.delete(key)
    this.usedBytes -= entry.bytes
    return true
  }

  clear() {
    this.entries.clear()
    this.usedBytes = 0
  }
}

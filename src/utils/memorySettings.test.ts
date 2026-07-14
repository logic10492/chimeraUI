import { describe, expect, it } from 'vitest'
import {
  memoryDedicatedToolsEnabled,
  memoryDedicatedToolsStatus,
  memoryEnabled,
  memoryEnabledStatus,
  nextMemoryDedicatedTools,
  nextMemoryEnabled,
  withMemoryDedicatedTools,
  withMemoryEnabled,
} from './memorySettings'

describe('memorySettings', () => {
  it('defaults both flags to off', () => {
    expect(memoryEnabled({})).toBe(false)
    expect(memoryDedicatedToolsEnabled({})).toBe(false)
    expect(memoryEnabledStatus({})).toBe('off')
    expect(memoryDedicatedToolsStatus({})).toBe('off')
  })

  it('builds partial memories patches for toggles', () => {
    expect(withMemoryEnabled({}, true)).toEqual({ memories: { enabled: true } })
    expect(withMemoryDedicatedTools({ memories: { enabled: true } }, true)).toEqual({
      memories: { enabled: true, dedicated_tools: true },
    })
    expect(nextMemoryEnabled({ memories: { enabled: true } })).toBe(false)
    expect(nextMemoryDedicatedTools({})).toBe(true)
  })
})

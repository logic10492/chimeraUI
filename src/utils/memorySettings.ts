export type MemorySettingsConfig = {
  memories?: {
    enabled?: boolean
    dedicated_tools?: boolean
  }
}

export function memoryEnabled(config: MemorySettingsConfig) {
  return config.memories?.enabled === true
}

export function memoryDedicatedToolsEnabled(config: MemorySettingsConfig) {
  return config.memories?.dedicated_tools === true
}

export function memoryEnabledStatus(config: MemorySettingsConfig) {
  return memoryEnabled(config) ? 'on' : 'off'
}

export function memoryDedicatedToolsStatus(config: MemorySettingsConfig) {
  return memoryDedicatedToolsEnabled(config) ? 'on' : 'off'
}

export function nextMemoryEnabled(config: MemorySettingsConfig) {
  return !memoryEnabled(config)
}

export function nextMemoryDedicatedTools(config: MemorySettingsConfig) {
  return !memoryDedicatedToolsEnabled(config)
}

export function withMemoryEnabled(config: MemorySettingsConfig, enabled: boolean) {
  return {
    memories: {
      ...config.memories,
      enabled,
    },
  }
}

export function withMemoryDedicatedTools(config: MemorySettingsConfig, dedicated_tools: boolean) {
  return {
    memories: {
      ...config.memories,
      dedicated_tools,
    },
  }
}

import type {
  AgentConfig as SDKAgentConfig,
  Config as SDKConfig,
  LayoutConfig as SDKLayoutConfig,
  LogLevel as SDKLogLevel,
  McpLocalConfig as SDKMcpLocalConfig,
  McpOAuthConfig as SDKMcpOAuthConfig,
  McpRemoteConfig as SDKMcpRemoteConfig,
  PermissionActionConfig as SDKPermissionActionConfig,
  PermissionConfig as SDKPermissionConfig,
  PermissionObjectConfig as SDKPermissionObjectConfig,
  PermissionRuleConfig as SDKPermissionRuleConfig,
  ProviderConfig as SDKProviderConfig,
  ServerConfig as SDKServerConfig,
} from '@opencode-ai/sdk/v2/client'

export type LogLevel = SDKLogLevel

export type ServerConfig = SDKServerConfig

export type PermissionActionConfig = SDKPermissionActionConfig

export type PermissionObjectConfig = SDKPermissionObjectConfig

export type PermissionRuleConfig = SDKPermissionRuleConfig

export type PermissionConfig = SDKPermissionConfig

export type AgentConfig = SDKAgentConfig

export type ProviderConfig = SDKProviderConfig

export type McpLocalConfig = SDKMcpLocalConfig

export type McpOAuthConfig = SDKMcpOAuthConfig

export type McpRemoteConfig = SDKMcpRemoteConfig

export type LayoutConfig = SDKLayoutConfig

export type Config = SDKConfig

export type RemoteCompactionSourceCategory = 'default' | 'global' | 'project' | 'environment' | 'account' | 'managed'

export interface RemoteCompactionValueMetadata {
  source: RemoteCompactionSourceCategory
  explicitAtWriteTarget: boolean
}

export interface RemoteCompactionWriteTargetMetadata {
  source: 'project'
  format: 'json' | 'jsonc'
  exists: boolean
}

export interface RemoteCompactionPolicyMetadata {
  remote: RemoteCompactionValueMetadata
  remote_protocol: RemoteCompactionValueMetadata
  writeTarget: RemoteCompactionWriteTargetMetadata
}

export type RemoteCompactionPolicyMode = 'auto' | 'on' | 'off'
export type RemoteCompactionProtocol = 'auto' | 'v2' | 'legacy'

export interface RemoteCompactionPolicy {
  remote: RemoteCompactionPolicyMode
  remote_protocol: RemoteCompactionProtocol
  metadata: RemoteCompactionPolicyMetadata
}

export interface RemoteCompactionPolicyPatch {
  remote?: RemoteCompactionPolicyMode | null
  remote_protocol?: RemoteCompactionProtocol | null
}

export interface RemoteCompactionEligibilityMetadata {
  modelRemoteCompaction: RemoteCompactionValueMetadata
  protocols: RemoteCompactionValueMetadata
  writeTarget: RemoteCompactionWriteTargetMetadata
}

export interface RemoteCompactionEligibility {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
  apiNpm: string
  wire_api: 'chat' | 'responses'
  providerCapability: {
    present: boolean
    protocols: Array<'v2' | 'legacy'>
  }
  modelRemoteCompaction: 'enabled' | 'disabled' | 'unset'
  configurable: boolean
  metadata?: RemoteCompactionEligibilityMetadata
}

export interface RemoteCompactionEligibilityList {
  items: RemoteCompactionEligibility[]
}

export interface RemoteCompactionEligibilityPatch {
  providerID: string
  modelID: string
  enabled: boolean | null
  protocols?: ['v2' | 'legacy'] | ['v2', 'legacy'] | ['legacy', 'v2']
}

export interface RemoteCompactionResolution {
  configured: {
    mode: RemoteCompactionPolicyMode
    protocol: RemoteCompactionProtocol
    metadata?: RemoteCompactionPolicyMetadata
  }
  requested: { providerID: string; modelID: string }
  effective: { providerID: string; modelID: string; wireModelID: string }
  mode: 'remote' | 'local'
  target: 'openai-codex' | 'provider' | 'local'
  profile?: 'codex-responses'
  driver?: 'codex-responses'
  credential: 'oauth' | 'provider-bearer' | 'configured' | 'missing' | 'unavailable'
  protocols: Array<'v2' | 'legacy'>
  localFallback: true
  reason:
    | 'policy_off'
    | 'provider_capability_missing'
    | 'model_disabled'
    | 'wire_api_not_responses'
    | 'credential_unavailable'
    | 'protocol_mismatch'
    | 'routing_identity_unsafe'
    | 'model_unsupported'
    | 'ready'
  binding?: {
    providerID: string
    modelID: string
    wireModelID: string
    driver: 'codex-responses'
    format: 'responses_compaction_v1'
    wire_api: 'responses'
    compatibility_key: string
  }
  lock:
    | { status: 'none' }
    | {
        status: 'exact' | 'route_mismatch' | 'model_mismatch'
        endpoint: 'openai-codex' | 'provider'
        providerID: string
        modelID: string
      }
  replay: {
    mode: 'none' | 'encoded' | 'full_history' | 'blocked'
    reason:
      | 'no_lock'
      | 'exact_binding'
      | 'model_mismatch'
      | 'transport_unavailable'
      | 'wire_api_not_responses'
      | 'binding_mismatch'
      | 'credential_unavailable'
      | 'routing_identity_unsafe'
  }
}

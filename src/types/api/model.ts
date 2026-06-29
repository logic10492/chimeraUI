import type {
  ConfigProvidersResponse as SDKConfigProvidersResponse,
  Model as SDKModel,
  Provider as SDKProvider,
  ProviderAuthAuthorization as SDKProviderAuthAuthorization,
  ProviderAuthMethod as SDKProviderAuthMethod,
} from '@opencode-ai/sdk/v2/client'

export type ModelIOCapabilities = SDKModel['capabilities']['input']

export type ModelCapabilities = SDKModel['capabilities']

export type ModelLimit = SDKModel['limit']

export type ModelStatus = SDKModel['status']

export type Model = SDKModel

export type Provider = SDKProvider

export type ProvidersResponse = SDKConfigProvidersResponse

export type ProviderAuthMethod = SDKProviderAuthMethod

export type ProviderAuthAuthorization = SDKProviderAuthAuthorization

export type ProviderBalanceStatus = 'available' | 'unavailable' | 'not_configured' | 'unsupported' | 'error'

export type ProviderBalanceResult =
  | {
      kind: 'billing'
      providerID: string
      status: ProviderBalanceStatus
      is_available?: boolean
      balance_infos: Array<{
        currency: string
        total_balance: string
        granted_balance: string
        topped_up_balance: string
      }>
      message?: string
    }
  | {
      kind: 'quota'
      providerID: string
      status: ProviderBalanceStatus
      label?: string
      plan_type?: string
      limits: Array<{
        label: string
        used_percent: number | string
        remaining_percent: number | string
        window_minutes?: number | string
        resets_at?: number | string
      }>
      message?: string
    }

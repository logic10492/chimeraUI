// ============================================
// Config API - 配置管理
// ============================================

import type { Client as SDKTransportClient } from '@opencode-ai/sdk/v2/gen/client'
import { getSDKClient, unwrap } from './sdk'
import { apiScopeQuery, resolveApiScope, resolveSessionApiScope, type ApiScopeInput } from './scope'
import type {
  Config,
  RemoteCompactionEligibility,
  RemoteCompactionEligibilityList,
  RemoteCompactionEligibilityPatch,
  RemoteCompactionPolicy,
  RemoteCompactionPolicyPatch,
  RemoteCompactionResolution,
} from '../types/api/config'
import type { Provider, ProvidersResponse } from '../types/api/model'

/**
 * 获取当前配置
 */
export async function getConfig(input?: ApiScopeInput): Promise<Config> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).config.get(apiScopeQuery(scope)))
}

/**
 * 获取用户全局配置（官方桌面设置写入的配置源）
 */
export async function getGlobalConfig(): Promise<Config> {
  const sdk = getSDKClient()
  return unwrap(await sdk.global.config.get())
}

/**
 * 更新配置
 */
export async function updateConfig(config: Config, input?: ApiScopeInput): Promise<Config> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).config.update({ ...apiScopeQuery(scope), config }))
}

/**
 * 更新用户全局配置。
 * 官方接口是 deep merge patch：支持新增/修改，不支持删除任意字段。
 */
export async function updateGlobalConfig(config: Config): Promise<Config> {
  const sdk = getSDKClient()
  return unwrap(await sdk.global.config.update({ config }))
}

/**
 * 获取 provider 配置列表
 */
export async function getProviderConfigs(input?: ApiScopeInput): Promise<ProvidersResponse> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).config.providers(apiScopeQuery(scope)))
}

export function providerCatalog(response?: ProvidersResponse): Record<string, Provider> {
  return Object.fromEntries((response?.providers ?? []).map(provider => [provider.id, provider]))
}

export function providerModelChoices(response?: ProvidersResponse) {
  return (response?.providers ?? []).flatMap(provider =>
    Object.keys(provider.models).map(modelID => ({
      value: `${provider.id}/${modelID}`,
      label: `${provider.id}/${modelID}`,
    })),
  )
}

export interface RemoteCompactionStatusInput {
  providerID: string
  modelID: string
  sessionID?: string
}

function resolveRemoteCompactionScope(sessionID: string | undefined, input?: ApiScopeInput) {
  return sessionID ? resolveSessionApiScope(sessionID, input) : resolveApiScope(input)
}

function remoteCompactionTransport(scope: ReturnType<typeof resolveApiScope>) {
  return (getSDKClient(scope) as unknown as { client: SDKTransportClient }).client
}

export async function getRemoteCompactionStatus(
  params: RemoteCompactionStatusInput,
  input?: ApiScopeInput,
): Promise<RemoteCompactionResolution> {
  const scope = resolveRemoteCompactionScope(params.sessionID, input)
  return unwrap(
    await remoteCompactionTransport(scope).get<{ 200: RemoteCompactionResolution }>({
      url: '/config/remote-compaction/status',
      query: {
        ...apiScopeQuery(scope),
        providerID: params.providerID,
        modelID: params.modelID,
        ...(params.sessionID ? { sessionID: params.sessionID } : {}),
      },
    }),
  )
}

export async function getRemoteCompactionPolicy(input?: ApiScopeInput): Promise<RemoteCompactionPolicy> {
  const scope = resolveApiScope(input)
  return unwrap(
    await remoteCompactionTransport(scope).get<{ 200: RemoteCompactionPolicy }>({
      url: '/config/remote-compaction',
      query: apiScopeQuery(scope),
    }),
  )
}

export async function updateRemoteCompactionPolicy(
  remoteCompactionPolicyPatch: RemoteCompactionPolicyPatch,
  sessionID?: string,
  input?: ApiScopeInput,
): Promise<RemoteCompactionPolicy> {
  const scope = resolveRemoteCompactionScope(sessionID, input)
  return unwrap(
    await remoteCompactionTransport(scope).patch<{ 200: RemoteCompactionPolicy }>({
      url: '/config/remote-compaction',
      query: apiScopeQuery(scope),
      body: remoteCompactionPolicyPatch,
    }),
  )
}

export async function getRemoteCompactionEligibility(input?: ApiScopeInput): Promise<RemoteCompactionEligibilityList> {
  const scope = resolveApiScope(input)
  return unwrap(
    await remoteCompactionTransport(scope).get<{ 200: RemoteCompactionEligibilityList }>({
      url: '/config/remote-compaction/eligibility',
      query: apiScopeQuery(scope),
    }),
  )
}

export async function updateRemoteCompactionEligibility(
  remoteCompactionEligibilityPatch: RemoteCompactionEligibilityPatch,
  input?: ApiScopeInput,
): Promise<RemoteCompactionEligibility> {
  const scope = resolveApiScope(input)
  return unwrap(
    await remoteCompactionTransport(scope).patch<{ 200: RemoteCompactionEligibility }>({
      url: '/config/remote-compaction/eligibility',
      query: apiScopeQuery(scope),
      body: remoteCompactionEligibilityPatch,
    }),
  )
}

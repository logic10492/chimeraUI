import type { ProviderAuthAuthorization, ProviderAuthMethod, ProviderListResponse } from '@opencode-ai/sdk/v2/client'
import { getSDKClient, unwrap } from './sdk'
import { apiScopeQuery, resolveApiScope, type ApiScopeInput } from './scope'

export async function listProviders(input?: ApiScopeInput): Promise<ProviderListResponse> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).provider.list(apiScopeQuery(scope)))
}

export async function listProviderAuthMethods(input?: ApiScopeInput): Promise<Record<string, ProviderAuthMethod[]>> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).provider.auth(apiScopeQuery(scope)))
}

export async function connectProviderApiKey(providerID: string, key: string, input?: ApiScopeInput) {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).auth.set({ providerID, auth: { type: 'api', key } }))
}

export async function authorizeProviderOAuth(
  providerID: string,
  method: number,
  inputs: Record<string, string> | undefined,
  input?: ApiScopeInput,
): Promise<ProviderAuthAuthorization> {
  const scope = resolveApiScope(input)
  return unwrap(
    await getSDKClient(scope).provider.oauth.authorize({
      providerID,
      ...apiScopeQuery(scope),
      method,
      inputs,
    }),
  )
}

export async function completeProviderOAuth(
  providerID: string,
  method: number,
  code: string | undefined,
  input?: ApiScopeInput,
) {
  const scope = resolveApiScope(input)
  return unwrap(
    await getSDKClient(scope).provider.oauth.callback({
      providerID,
      ...apiScopeQuery(scope),
      method,
      code,
    }),
  )
}

export async function disconnectProvider(providerID: string, input?: ApiScopeInput) {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).auth.remove({ providerID }))
}

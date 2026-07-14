import type {
  WebUIPreferencesRevisionConflictData,
  WebUIPreferencesRevisionConflictResponse,
  WebUIPreferencesSnapshot,
  WebUIPreferencesUpdate,
} from '../types/api/preferences'
import { getSDKClient, unwrap } from './sdk'

export class WebUIPreferencesRevisionConflictError extends Error {
  readonly data: WebUIPreferencesRevisionConflictData

  constructor(data: WebUIPreferencesRevisionConflictData) {
    super('WebUI preferences revision conflict')
    this.name = 'WebUIPreferencesRevisionConflictError'
    this.data = data
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function conflictData(value: unknown): WebUIPreferencesRevisionConflictData | null {
  if (!isRecord(value) || value.name !== 'WebUIPreferencesRevisionConflictError' || !isRecord(value.data)) return null
  if (typeof value.data.expectedRevision !== 'number' || typeof value.data.actualRevision !== 'number') return null
  return {
    expectedRevision: value.data.expectedRevision,
    actualRevision: value.data.actualRevision,
  }
}

export async function getWebUIPreferences(serverID?: string): Promise<WebUIPreferencesSnapshot> {
  return unwrap(await getSDKClient(serverID ? { serverID } : undefined).global.preferences.get())
}

export async function updateWebUIPreferences(
  input: WebUIPreferencesUpdate,
  serverID?: string,
): Promise<WebUIPreferencesSnapshot> {
  const result = await getSDKClient(serverID ? { serverID } : undefined).global.preferences.update({
    webUiPreferencesUpdate: input,
  })
  const data = conflictData(result.error)
  if (result.response?.status === 409 || data) {
    throw new WebUIPreferencesRevisionConflictError(
      data ?? {
        expectedRevision: input.revision,
        actualRevision: input.revision,
      },
    )
  }
  return unwrap(result)
}

export function isWebUIPreferencesRevisionConflictError(
  error: unknown,
): error is WebUIPreferencesRevisionConflictError | WebUIPreferencesRevisionConflictResponse {
  return error instanceof WebUIPreferencesRevisionConflictError || conflictData(error) !== null
}

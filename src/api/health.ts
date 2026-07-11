import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import { isTauri } from '../utils/tauri'

export interface HealthAuth {
  username: string
  password: string
}

export interface CandidateServerHealth {
  status: 'online' | 'offline' | 'error' | 'unauthorized'
  latency?: number
  lastCheck: number
  error?: string
  details: string
  version?: string
}

export interface CheckCandidateServerHealthOptions {
  serverUrl: string
  auth?: HealthAuth
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}

let tauriFetch: typeof globalThis.fetch | null = null
let tauriFetchLoading: Promise<typeof globalThis.fetch> | null = null

export async function getUnifiedFetch(): Promise<typeof globalThis.fetch> {
  if (!isTauri()) return globalThis.fetch
  if (tauriFetch) return tauriFetch
  if (tauriFetchLoading) return tauriFetchLoading
  tauriFetchLoading = import('@tauri-apps/plugin-http').then(mod => {
    tauriFetch = mod.fetch as unknown as typeof globalThis.fetch
    return tauriFetch
  })
  return tauriFetchLoading
}

export function makeBasicAuthHeader(auth: HealthAuth): string {
  return 'Basic ' + btoa(`${auth.username}:${auth.password}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeConnectionError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return 'Connection timed out'
  if (!(err instanceof Error)) return 'Connection failed'

  const message = err.message || 'Connection failed'
  if (/certificate|cert|tls|ssl/i.test(message)) return `TLS/certificate error: ${message}`
  return message
}

function headersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].map(([key, value]) => [
      key,
      /set-cookie|authorization|proxy-authorization/i.test(key) ? '<redacted>' : value,
    ]),
  )
}

function truncateForDiagnostics(value: string, maxLength = 5000): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`
}

function formatResponseDiagnostics(options: {
  url: string
  response: Response
  latency: number
  body: string
}): string {
  const contentType = options.response.headers.get('content-type') ?? ''
  return [
    `Request: GET ${options.url}`,
    `Status: ${options.response.status}${options.response.statusText ? ` ${options.response.statusText}` : ''}`,
    `Latency: ${options.latency}ms`,
    `Content-Type: ${contentType || '(none)'}`,
    `Headers:\n${JSON.stringify(headersToRecord(options.response.headers), null, 2)}`,
    `Body (${options.body.length} chars):\n${truncateForDiagnostics(options.body)}`,
  ].join('\n\n')
}

function formatExceptionDiagnostics(url: string, err: unknown): string {
  if (!(err instanceof Error) && !(err instanceof DOMException)) return `Request: GET ${url}\n\nError: ${String(err)}`

  const cause = 'cause' in err && err.cause !== undefined ? `\n\nCause:\n${String(err.cause)}` : ''
  return (
    [
      `Request: GET ${url}`,
      `Error name: ${err.name}`,
      `Message: ${err.message}`,
      err.stack ? `Stack:\n${err.stack}` : '',
    ]
      .filter(Boolean)
      .join('\n\n') + cause
  )
}

export async function checkCandidateServerHealth(
  options: CheckCandidateServerHealthOptions,
): Promise<CandidateServerHealth> {
  const serverUrl = options.serverUrl.replace(/\/+$/, '')
  const healthUrl = `${serverUrl}/global/health`
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000)
  let capturedResponse: Response | undefined

  let fetchError: unknown

  try {
    const fetch = options.fetch ?? (await getUnifiedFetch())
    const client = createOpencodeClient({
      baseUrl: serverUrl,
      headers: options.auth?.password ? { Authorization: makeBasicAuthHeader(options.auth) } : {},
      fetch: async (input, init) => {
        try {
          const response = await fetch(input, { ...init, signal: controller.signal })
          capturedResponse = response.clone()
          return response
        } catch (err) {
          fetchError = err
          throw err
        }
      },
    })

    try {
      await client.global.health()
    } catch (err) {
      if (!capturedResponse) throw err
    }

    if (!capturedResponse) throw fetchError ?? new Error('Health request completed without a response')
    const response = capturedResponse
    const latency = Date.now() - startedAt
    const responseBody = await response
      .text()
      .catch(err => `[Failed to read response body: ${normalizeConnectionError(err)}]`)
    const details = formatResponseDiagnostics({ url: healthUrl, response, latency, body: responseBody })
    const lastCheck = Date.now()

    if (response.status === 401) {
      return { status: 'unauthorized', latency, lastCheck, error: 'Invalid credentials', details }
    }
    if (!response.ok) {
      return { status: 'error', latency, lastCheck, error: `HTTP ${response.status}`, details }
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json')) {
      return {
        status: 'error',
        latency,
        lastCheck,
        error: contentType.includes('text/html')
          ? 'Server returned HTML instead of OpenCode health JSON. Check the URL path.'
          : 'Server did not return OpenCode health JSON',
        details,
      }
    }

    let data: unknown
    try {
      data = JSON.parse(responseBody)
    } catch {
      return { status: 'error', latency, lastCheck, error: 'Invalid OpenCode health JSON', details }
    }
    if (!isRecord(data) || data.healthy !== true || typeof data.version !== 'string' || !data.version.trim()) {
      return { status: 'error', latency, lastCheck, error: 'Not an OpenCode server', details }
    }
    return { status: 'online', latency, lastCheck, version: data.version, details }
  } catch (err) {
    return {
      status: 'offline',
      lastCheck: Date.now(),
      error: normalizeConnectionError(err),
      details: formatExceptionDiagnostics(healthUrl, err),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

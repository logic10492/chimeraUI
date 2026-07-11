import { getAuthHeader } from './http'
import { buildPtyConnectUrl } from './pty'
import { apiScopeKey, resolveApiScope, type ApiScope } from './scope'

/** Unified bridge event from Rust */
interface BridgeEvent {
  event: 'connected' | 'data' | 'disconnected' | 'error'
  data?: {
    data?: string
    code?: number
    reason?: string
    message?: string
  }
}

interface ConnectTauriPtyParams {
  ptyId: string
  directory?: string
  apiScope?: ApiScope
  cursor?: number
  onConnected: () => void
  onMessage: (chunk: string) => void
  onDisconnected: (info: { code?: number; reason?: string }) => void
  onError: (message: string) => void
}

export interface TauriPtyConnection {
  send: (data: string) => void
  close: () => void
}

let bridgeSequence = 0

export async function connectTauriPty({
  ptyId,
  directory,
  apiScope,
  cursor,
  onConnected,
  onMessage,
  onDisconnected,
  onError,
}: ConnectTauriPtyParams): Promise<TauriPtyConnection> {
  const { invoke, Channel } = await import('@tauri-apps/api/core')
  const scope = resolveApiScope(apiScope ?? directory)
  const url = buildPtyConnectUrl(ptyId, scope, { cursor })
  const authHeader = getAuthHeader(scope)['Authorization'] || null
  const bridgeId = `${apiScopeKey(scope)}:${ptyId}:${++bridgeSequence}`
  const onEvent = new Channel<BridgeEvent>()
  let closed = false
  const disconnect = () => {
    void invoke('bridge_disconnect', { args: { bridgeId } }).catch(() => {})
  }

  onEvent.onmessage = msg => {
    if (closed) {
      if (msg.event === 'connected') disconnect()
      return
    }

    switch (msg.event) {
      case 'connected':
        onConnected()
        break
      case 'data':
        if (msg.data?.data) {
          onMessage(msg.data.data)
        }
        break
      case 'disconnected':
        closed = true
        onDisconnected({ code: msg.data?.code, reason: msg.data?.reason })
        break
      case 'error':
        onError(msg.data?.message || 'Unknown bridge error')
        break
    }
  }

  void invoke('bridge_connect', {
    args: { bridgeId, url, authHeader },
    onEvent,
  }).catch((error: unknown) => {
    if (closed) return
    closed = true
    const message = error instanceof Error ? error.message : String(error)
    onDisconnected({ reason: message })
  })

  return {
    send(data: string) {
      if (closed) return
      void invoke('bridge_send', { args: { bridgeId, data } }).catch((error: unknown) => {
        if (closed) return
        const message = error instanceof Error ? error.message : String(error)
        onError(message)
      })
    },
    close() {
      if (closed) return
      closed = true
      disconnect()
    },
  }
}

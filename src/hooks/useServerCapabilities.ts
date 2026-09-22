import { useEffect, useState } from 'react'
import { getServerCapabilities, type ServerCapabilities } from '../api/capabilities'
import { apiScopeKey, resolveApiScope, type ApiScopeInput } from '../api/scope'

const UNKNOWN: ServerCapabilities = { backgroundSubagents: false }

/**
 * Server capability flags for the given (or active) ApiScope. Resolves
 * fail-closed: capabilities are all-false until the config fetch succeeds,
 * and stay false on error. Results are cached per scope in the api layer.
 */
export function useServerCapabilities(input?: ApiScopeInput): ServerCapabilities {
  const [capabilities, setCapabilities] = useState<ServerCapabilities>(UNKNOWN)
  const scopeKey = apiScopeKey(resolveApiScope(input))
  useEffect(() => {
    let active = true
    void getServerCapabilities(input).then((resolved) => {
      if (active) setCapabilities(resolved)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])
  return capabilities
}

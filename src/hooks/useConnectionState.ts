import { useEffect, useState } from 'react'
import { getConnectionInfo, subscribeToConnectionState } from '../api/events'

export function useConnectionState(): string {
  const [state, setState] = useState(() => getConnectionInfo().state)

  useEffect(() => {
    return subscribeToConnectionState(info => setState(info.state))
  }, [])

  return state
}

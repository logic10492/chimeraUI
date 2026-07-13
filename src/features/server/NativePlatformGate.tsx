import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { checkCandidateServerHealth } from '../../api/health'
import { serverStore } from '../../store/serverStore'
import { getRuntimePlatform } from '../../utils/tauri'

export function NativePlatformGate({ children }: { children: ReactNode }) {
  const activeServer = useSyncExternalStore(
    serverStore.subscribe.bind(serverStore),
    () => serverStore.getActiveServer(),
    () => serverStore.getActiveServer(),
  )
  const platform = getRuntimePlatform()

  if (platform === 'tauri-ios') return <UnsupportedNativeIOS />
  if (platform === 'tauri-android' && !activeServer) return <AndroidServerSetup />
  return children
}

function UnsupportedNativeIOS() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg-000 p-6 text-text-100">
      <section className="w-full max-w-md rounded-xl border border-border-200 bg-bg-100 p-6 shadow-xl">
        <h1 className="text-xl font-semibold">Chimera for iOS is not supported yet</h1>
        <p className="mt-3 text-sm leading-relaxed text-text-300">
          This native build currently supports Android only. You can continue to use Chimera from Safari or install the
          web app instead.
        </p>
      </section>
    </main>
  )
}

function AndroidServerSetup() {
  const [name, setName] = useState('Remote')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    let normalizedUrl: string
    try {
      const parsed = new URL(url.trim())
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setError('Enter an HTTP or HTTPS server URL.')
        return
      }
      normalizedUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
    } catch {
      setError('Enter a valid HTTP or HTTPS server URL.')
      return
    }
    if (normalizedUrl === window.location.origin) {
      setError('The Android app needs the address of a reachable Chimera server, not the app WebView address.')
      return
    }

    setChecking(true)
    const auth = password ? { username: username.trim() || 'chimera', password } : undefined
    const health = await checkCandidateServerHealth({ serverUrl: normalizedUrl, auth })
    setChecking(false)

    if (health.status !== 'online') {
      setError(health.error || 'Unable to connect to this Chimera server.')
      return
    }

    const server = serverStore.addServer({ name: name.trim() || 'Remote', url: normalizedUrl, auth })
    serverStore.setActiveServer(server.id)
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg-000 p-6 text-text-100">
      <form className="w-full max-w-md rounded-xl border border-border-200 bg-bg-100 p-6 shadow-xl" onSubmit={connect}>
        <h1 className="text-xl font-semibold">Connect to a Chimera server</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-300">
          Android does not run a local Chimera service. Enter a server address reachable from this device.
        </p>
        <div className="mt-5 space-y-3">
          <label className="block text-sm text-text-300">
            Name
            <input
              className="mt-1 w-full rounded-md border border-border-200 bg-bg-000 px-3 py-2 text-text-100 outline-none focus:border-accent-main-100"
              value={name}
              onChange={event => setName(event.target.value)}
            />
          </label>
          <label className="block text-sm text-text-300">
            Server URL
            <input
              className="mt-1 w-full rounded-md border border-border-200 bg-bg-000 px-3 py-2 text-text-100 outline-none focus:border-accent-main-100"
              type="url"
              inputMode="url"
              placeholder="https://chimera.example.com"
              required
              value={url}
              onChange={event => setUrl(event.target.value)}
            />
          </label>
          <label className="block text-sm text-text-300">
            Username
            <input
              className="mt-1 w-full rounded-md border border-border-200 bg-bg-000 px-3 py-2 text-text-100 outline-none focus:border-accent-main-100"
              autoComplete="username"
              value={username}
              onChange={event => setUsername(event.target.value)}
            />
          </label>
          <label className="block text-sm text-text-300">
            Password
            <input
              className="mt-1 w-full rounded-md border border-border-200 bg-bg-000 px-3 py-2 text-text-100 outline-none focus:border-accent-main-100"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-danger-100">{error}</p>}
        <button
          className="mt-5 w-full rounded-md bg-accent-main-100 px-4 py-2 font-medium text-white disabled:opacity-50"
          type="submit"
          disabled={checking}
        >
          {checking ? 'Checking server…' : 'Connect'}
        </button>
      </form>
    </main>
  )
}

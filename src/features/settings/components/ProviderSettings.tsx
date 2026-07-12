import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Provider, ProviderAuthAuthorization, ProviderAuthMethod } from '../../../types/api/model'
import {
  authorizeProviderOAuth,
  completeProviderOAuth,
  connectProviderApiKey,
  disconnectProvider,
  listProviderAuthMethods,
  listProviders,
} from '../../../api'
import { useCurrentDirectory } from '../../../hooks'
import { isTauri } from '../../../utils/tauri'
import { SettingsCard, SettingsSection } from './SettingsUI'
import { tx } from './configEditorUtils'
import { useTranslation } from 'react-i18next'

type ConnectState = {
  provider: Provider
  methods: ProviderAuthMethod[]
  methodIndex?: number
  inputs: Record<string, string>
  authorization?: ProviderAuthAuthorization
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return JSON.stringify(error)
}

async function openExternal(url: string) {
  if (isTauri()) {
    await import('@tauri-apps/plugin-opener')
      .then(mod => mod.openUrl(url))
      .catch(() => window.open(url, '_blank', 'noopener,noreferrer'))
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

function promptVisible(prompt: NonNullable<ProviderAuthMethod['prompts']>[number], inputs: Record<string, string>) {
  if (!prompt.when) return true
  const value = inputs[prompt.when.key]
  if (prompt.when.op === 'eq') return value === prompt.when.value
  return value !== prompt.when.value
}

export function ProviderSettings() {
  const { i18n } = useTranslation('settings')
  const lang = i18n.language
  const directory = useCurrentDirectory()
  const [providers, setProviders] = useState<Provider[]>([])
  const [connected, setConnected] = useState<Set<string>>(() => new Set())
  const [authMethods, setAuthMethods] = useState<Record<string, ProviderAuthMethod[]>>({})
  const [connect, setConnect] = useState<ConnectState | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [providerResult, methods] = await Promise.all([
        listProviders(directory),
        listProviderAuthMethods(directory),
      ])
      setProviders(providerResult.all)
      setConnected(new Set(providerResult.connected))
      setAuthMethods(methods)
    } catch (value) {
      setError(errorMessage(value))
    } finally {
      setLoading(false)
    }
  }, [directory])

  useEffect(() => {
    void load()
  }, [load])

  const connectedProviders = useMemo(
    () => providers.filter(provider => connected.has(provider.id)),
    [connected, providers],
  )
  const availableProviders = useMemo(
    () => providers.filter(provider => !connected.has(provider.id)),
    [connected, providers],
  )
  const selectedMethod = connect?.methodIndex === undefined ? undefined : connect.methods[connect.methodIndex]

  const beginConnect = (provider: Provider) => {
    const methods = authMethods[provider.id]?.length
      ? authMethods[provider.id]
      : [{ type: 'api' as const, label: tx('API key', 'API 密钥', lang) }]
    setApiKey('')
    setCode('')
    setError(null)
    setConnect({ provider, methods, methodIndex: methods.length === 1 ? 0 : undefined, inputs: {} })
  }

  const startOAuth = async () => {
    if (!connect || connect.methodIndex === undefined || selectedMethod?.type !== 'oauth') return
    setBusy(true)
    setError(null)
    try {
      const authorization = await authorizeProviderOAuth(
        connect.provider.id,
        connect.methodIndex,
        connect.inputs,
        directory,
      )
      setConnect(current => (current ? { ...current, authorization } : current))
      await openExternal(authorization.url)
      if (authorization.method === 'auto') {
        await completeProviderOAuth(connect.provider.id, connect.methodIndex, undefined, directory)
        setConnect(null)
        await load()
      }
    } catch (value) {
      setError(errorMessage(value))
    } finally {
      setBusy(false)
    }
  }

  const submitApiKey = async () => {
    if (!connect || !apiKey.trim()) return
    setBusy(true)
    setError(null)
    try {
      await connectProviderApiKey(connect.provider.id, apiKey.trim(), directory)
      setConnect(null)
      await load()
    } catch (value) {
      setError(errorMessage(value))
    } finally {
      setBusy(false)
    }
  }

  const submitOAuthCode = async () => {
    if (!connect || connect.methodIndex === undefined || !code.trim()) return
    setBusy(true)
    setError(null)
    try {
      await completeProviderOAuth(connect.provider.id, connect.methodIndex, code.trim(), directory)
      setConnect(null)
      await load()
    } catch (value) {
      setError(errorMessage(value))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (provider: Provider) => {
    setBusy(true)
    setError(null)
    try {
      await disconnectProvider(provider.id, directory)
      await load()
    } catch (value) {
      setError(errorMessage(value))
    } finally {
      setBusy(false)
    }
  }

  const buttonClass =
    'rounded-lg border border-border-200/60 px-3 py-1.5 text-[length:var(--fs-xs)] font-medium text-text-200 transition-colors hover:bg-bg-100 disabled:opacity-40'
  const inputClass =
    'w-full rounded-lg border border-border-200/60 bg-bg-100/60 px-3 py-2 text-[length:var(--fs-sm)] text-text-100 outline-none focus:border-accent-main-100/60'

  if (loading) return <div className="p-6 text-text-400">{tx('Loading providers…', '正在加载 Provider…', lang)}</div>

  return (
    <div className="max-w-3xl px-6 py-6">
      {error && (
        <div className="mb-5 rounded-lg border border-danger-100/30 bg-danger-100/5 p-3 text-[length:var(--fs-sm)] text-danger-100">
          {error}
        </div>
      )}

      {connect && (
        <SettingsSection title={tx(`Connect ${connect.provider.name}`, `连接 ${connect.provider.name}`, lang)}>
          {connect.methodIndex === undefined ? (
            <div className="flex flex-wrap gap-2">
              {connect.methods.map((method, index) => (
                <button
                  key={`${method.type}-${method.label}`}
                  type="button"
                  className={buttonClass}
                  onClick={() => setConnect({ ...connect, methodIndex: index })}
                >
                  {method.label}
                </button>
              ))}
            </div>
          ) : selectedMethod?.type === 'api' ? (
            <div className="flex max-w-xl gap-2">
              <input
                className={inputClass}
                type="password"
                value={apiKey}
                placeholder={tx('API key', 'API 密钥', lang)}
                onChange={event => setApiKey(event.target.value)}
              />
              <button
                type="button"
                className={buttonClass}
                disabled={busy || !apiKey.trim()}
                onClick={() => void submitApiKey()}
              >
                {tx('Connect', '连接', lang)}
              </button>
            </div>
          ) : !connect.authorization ? (
            <div className="flex max-w-xl flex-col gap-3">
              {(selectedMethod?.prompts ?? [])
                .filter(prompt => promptVisible(prompt, connect.inputs))
                .map(prompt =>
                  prompt.type === 'select' ? (
                    <label key={prompt.key} className="flex flex-col gap-1 text-[length:var(--fs-sm)] text-text-300">
                      {prompt.message}
                      <select
                        className={inputClass}
                        value={connect.inputs[prompt.key] ?? ''}
                        onChange={event =>
                          setConnect({ ...connect, inputs: { ...connect.inputs, [prompt.key]: event.target.value } })
                        }
                      >
                        <option value="">{tx('Select…', '请选择…', lang)}</option>
                        {prompt.options.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label key={prompt.key} className="flex flex-col gap-1 text-[length:var(--fs-sm)] text-text-300">
                      {prompt.message}
                      <input
                        className={inputClass}
                        value={connect.inputs[prompt.key] ?? ''}
                        placeholder={prompt.placeholder}
                        onChange={event =>
                          setConnect({ ...connect, inputs: { ...connect.inputs, [prompt.key]: event.target.value } })
                        }
                      />
                    </label>
                  ),
                )}
              <button
                type="button"
                className={`${buttonClass} self-start`}
                disabled={busy}
                onClick={() => void startOAuth()}
              >
                {tx('Authorize in browser', '在浏览器中授权', lang)}
              </button>
            </div>
          ) : connect.authorization.method === 'code' ? (
            <div className="flex max-w-xl flex-col gap-3">
              <p className="text-[length:var(--fs-sm)] text-text-300">{connect.authorization.instructions}</p>
              <button
                type="button"
                className={`${buttonClass} self-start`}
                onClick={() => void openExternal(connect.authorization!.url)}
              >
                {tx('Open authorization page', '打开授权页面', lang)}
              </button>
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  value={code}
                  placeholder={tx('Authorization code', '授权码', lang)}
                  onChange={event => setCode(event.target.value)}
                />
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || !code.trim()}
                  onClick={() => void submitOAuthCode()}
                >
                  {tx('Complete', '完成', lang)}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[length:var(--fs-sm)] text-text-300">
              {tx('Waiting for browser authorization to complete…', '正在等待浏览器授权完成…', lang)}
            </p>
          )}
          <button type="button" className={buttonClass} disabled={busy} onClick={() => setConnect(null)}>
            {tx('Cancel', '取消', lang)}
          </button>
        </SettingsSection>
      )}

      <SettingsSection title={tx('Connected providers', '已连接的 Provider', lang)}>
        {connectedProviders.length === 0 ? (
          <p className="text-[length:var(--fs-sm)] text-text-400">
            {tx('No providers connected.', '尚未连接 Provider。', lang)}
          </p>
        ) : (
          connectedProviders.map(provider => (
            <SettingsCard
              key={provider.id}
              title={provider.name}
              description={provider.source}
              actions={
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || provider.source === 'env'}
                  onClick={() => void remove(provider)}
                >
                  {provider.source === 'env' ? tx('Environment', '环境变量', lang) : tx('Disconnect', '断开连接', lang)}
                </button>
              }
            >
              <div className="text-[length:var(--fs-xs)] text-text-400">
                {Object.keys(provider.models).length} {tx('models', '个模型', lang)}
              </div>
            </SettingsCard>
          ))
        )}
      </SettingsSection>

      <SettingsSection title={tx('Available providers', '可用的 Provider', lang)}>
        <div className="flex flex-col gap-3">
          {availableProviders.map(provider => (
            <SettingsCard
              key={provider.id}
              title={provider.name}
              description={`${Object.keys(provider.models).length} ${tx('models', '个模型', lang)}`}
              actions={
                <button type="button" className={buttonClass} disabled={busy} onClick={() => beginConnect(provider)}>
                  {tx('Connect', '连接', lang)}
                </button>
              }
            >
              <div />
            </SettingsCard>
          ))}
        </div>
      </SettingsSection>
    </div>
  )
}

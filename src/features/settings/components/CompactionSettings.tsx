import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RemoteCompactionEligibility,
  RemoteCompactionEligibilityPatch,
  RemoteCompactionPolicyPatch,
  RemoteCompactionResolution,
} from '@opencode-ai/sdk/v2'
import {
  getRemoteCompactionEligibility,
  getRemoteCompactionStatus,
  updateRemoteCompactionEligibility,
  updateRemoteCompactionPolicy,
} from '../../../api/config'
import { usePaneController } from '../../../store/paneControllerStore'
import { usePaneLayout } from '../../../store/paneLayoutStore'
import { SettingsSection } from './SettingsUI'

const protocolChoices = ['v2,legacy', 'v2', 'legacy,v2', 'legacy'] as const
type ProtocolChoice = (typeof protocolChoices)[number]
type Selection = { directory: string; providerID: string; modelID: string }
type StatusIdentity = Selection & { sessionID?: string }
type StatusEntry = { key: string; value: RemoteCompactionResolution }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function selectionKey(identity: Pick<Selection, 'directory' | 'providerID' | 'modelID'>) {
  return `${identity.directory}\u0000${identity.providerID}\u0000${identity.modelID}`
}

function statusKey(identity: StatusIdentity) {
  return `${selectionKey(identity)}\u0000${identity.sessionID ?? ''}`
}

function protocolsFor(choice: ProtocolChoice): RemoteCompactionEligibilityPatch['protocols'] {
  if (choice === 'v2,legacy') return ['v2', 'legacy']
  if (choice === 'legacy,v2') return ['legacy', 'v2']
  return [choice]
}

export function CompactionSettings() {
  const { t } = useTranslation(['settings'])
  const paneLayout = usePaneLayout()
  const controller = usePaneController(paneLayout.focusedPaneId)
  const directory = controller?.effectiveDirectory ?? ''
  const focused = useMemo(
    () =>
      controller?.currentProviderId && controller.currentModelId
        ? { directory, providerID: controller.currentProviderId, modelID: controller.currentModelId }
        : null,
    [controller?.currentModelId, controller?.currentProviderId, directory],
  )
  const [eligibility, setEligibility] = useState<RemoteCompactionEligibility[]>([])
  const [eligibilityDirectory, setEligibilityDirectory] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [protocolOverrides, setProtocolOverrides] = useState<Record<string, ProtocolChoice>>({})
  const [status, setStatus] = useState<StatusEntry | null>(null)
  const [eligibilityError, setEligibilityError] = useState<{ directory: string; message: string } | null>(null)
  const [statusError, setStatusError] = useState<{ key: string; message: string } | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [eligibilityLoading, setEligibilityLoading] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState<string | null>(null)
  const [policySaving, setPolicySaving] = useState(false)
  const [eligibilitySaving, setEligibilitySaving] = useState(false)
  const eligibilityRequestID = useRef(0)
  const statusRequestID = useRef(0)
  const policySavingRef = useRef(false)
  const eligibilitySavingRef = useRef(false)
  const currentDirectoryRef = useRef(directory)
  const currentIdentityRef = useRef<StatusIdentity | null>(null)
  const focusedRef = useRef(focused)

  const currentEligibility = useMemo(
    () => (eligibilityDirectory === directory ? eligibility : []),
    [directory, eligibility, eligibilityDirectory],
  )
  const currentSelection = selection?.directory === directory ? selection : null
  const selectedIdentity =
    currentSelection ??
    focused ??
    (currentEligibility[0]
      ? { directory, providerID: currentEligibility[0].providerID, modelID: currentEligibility[0].modelID }
      : null)
  const selected = selectedIdentity
    ? currentEligibility.find(
        item => item.providerID === selectedIdentity.providerID && item.modelID === selectedIdentity.modelID,
      )
    : undefined
  const currentStatusIdentity = selectedIdentity
    ? {
        ...selectedIdentity,
        ...(focused &&
        selectedIdentity.providerID === focused.providerID &&
        selectedIdentity.modelID === focused.modelID &&
        controller?.sessionId
          ? { sessionID: controller.sessionId }
          : {}),
      }
    : null
  const currentStatusKey = currentStatusIdentity ? statusKey(currentStatusIdentity) : ''
  const visibleStatus = status?.key === currentStatusKey ? status.value : null
  const visibleStatusError = statusError?.key === currentStatusKey ? statusError.message : null
  const isStatusLoading = statusLoading === currentStatusKey
  const isEligibilityLoading = eligibilityLoading === directory
  const visibleEligibilityError = eligibilityError?.directory === directory ? eligibilityError.message : null

  currentDirectoryRef.current = directory
  currentIdentityRef.current = currentStatusIdentity
  focusedRef.current = focused

  const providers = useMemo(() => {
    const rows = currentEligibility.map(item => [item.providerID, item.providerName] as const)
    if (focused && !rows.some(([providerID]) => providerID === focused.providerID))
      rows.unshift([focused.providerID, focused.providerID])
    return Array.from(new Map(rows).entries())
  }, [currentEligibility, focused])
  const selectedProviderID = selectedIdentity?.providerID ?? providers[0]?.[0] ?? ''
  const models = useMemo(() => {
    const rows = currentEligibility
      .filter(item => item.providerID === selectedProviderID)
      .map(item => ({ providerID: item.providerID, modelID: item.modelID, modelName: item.modelName }))
    if (focused && focused.providerID === selectedProviderID && !rows.some(item => item.modelID === focused.modelID)) {
      rows.unshift({ providerID: focused.providerID, modelID: focused.modelID, modelName: focused.modelID })
    }
    return rows
  }, [currentEligibility, focused, selectedProviderID])
  const configuredProtocols = selected?.providerCapability.protocols.join(',')
  const protocolChoice = selectedIdentity
    ? (protocolOverrides[selectionKey(selectedIdentity)] ??
      (protocolChoices.includes(configuredProtocols as ProtocolChoice)
        ? (configuredProtocols as ProtocolChoice)
        : 'v2,legacy'))
    : 'v2,legacy'

  const requestStatus = useCallback(async (identity: StatusIdentity | null) => {
    const request = ++statusRequestID.current
    if (!identity) {
      setStatus(null)
      setStatusError(null)
      setStatusLoading(null)
      return
    }
    const key = statusKey(identity)
    setStatus(null)
    setStatusError(null)
    setStatusLoading(key)
    return getRemoteCompactionStatus(
      {
        providerID: identity.providerID,
        modelID: identity.modelID,
        ...(identity.sessionID ? { sessionID: identity.sessionID } : {}),
      },
      identity.directory,
    )
      .then(value => {
        if (
          request !== statusRequestID.current ||
          (currentIdentityRef.current && statusKey(currentIdentityRef.current) !== key)
        )
          return
        setStatus({ key, value })
      })
      .catch(error => {
        if (
          request !== statusRequestID.current ||
          (currentIdentityRef.current && statusKey(currentIdentityRef.current) !== key)
        )
          return
        setStatusError({ key, message: errorMessage(error) })
      })
      .finally(() => {
        if (request === statusRequestID.current) setStatusLoading(null)
      })
  }, [])

  const refreshCurrentStatus = useCallback(() => requestStatus(currentIdentityRef.current), [requestStatus])

  const loadEligibility = useCallback(async (targetDirectory = currentDirectoryRef.current) => {
    if (!targetDirectory) return
    const request = ++eligibilityRequestID.current
    setEligibilityDirectory(targetDirectory)
    setEligibility([])
    setEligibilityError(null)
    setEligibilityLoading(targetDirectory)
    return getRemoteCompactionEligibility(targetDirectory)
      .then(result => {
        if (request !== eligibilityRequestID.current || currentDirectoryRef.current !== targetDirectory) return
        setEligibility(result.items)
        setSelection(current => {
          if (
            current?.directory === targetDirectory &&
            result.items.some(item => item.providerID === current.providerID && item.modelID === current.modelID)
          )
            return current
          const currentFocused = focusedRef.current?.directory === targetDirectory ? focusedRef.current : null
          if (currentFocused) return currentFocused
          const first = result.items.find(item => item.configurable) ?? result.items[0]
          return first ? { directory: targetDirectory, providerID: first.providerID, modelID: first.modelID } : null
        })
      })
      .catch(error => {
        if (request !== eligibilityRequestID.current || currentDirectoryRef.current !== targetDirectory) return
        setEligibilityError({ directory: targetDirectory, message: errorMessage(error) })
      })
      .finally(() => {
        if (request === eligibilityRequestID.current) setEligibilityLoading(null)
      })
  }, [])

  useEffect(() => {
    queueMicrotask(() => void loadEligibility(directory))
  }, [directory, loadEligibility])

  useEffect(() => {
    queueMicrotask(() => void requestStatus(currentIdentityRef.current))
  }, [currentStatusKey, requestStatus])

  const savePolicy = async (patch: RemoteCompactionPolicyPatch) => {
    if (policySavingRef.current || !directory || !visibleStatus) return
    policySavingRef.current = true
    setPolicySaving(true)
    setSaveError(null)
    return updateRemoteCompactionPolicy(patch, undefined, directory)
      .then(() => refreshCurrentStatus())
      .catch(error => setSaveError(errorMessage(error)))
      .finally(() => {
        policySavingRef.current = false
        setPolicySaving(false)
      })
  }

  const saveEligibility = async (enabled: boolean) => {
    if (eligibilitySavingRef.current || !selected?.configurable || !selectedIdentity) return
    const targetDirectory = selectedIdentity.directory
    eligibilitySavingRef.current = true
    setEligibilitySaving(true)
    setSaveError(null)
    const patch: RemoteCompactionEligibilityPatch = {
      providerID: selected.providerID,
      modelID: selected.modelID,
      enabled,
      ...(enabled ? { protocols: protocolsFor(protocolChoice) } : {}),
    }
    return updateRemoteCompactionEligibility(patch, targetDirectory)
      .then(() => Promise.all([loadEligibility(currentDirectoryRef.current), refreshCurrentStatus()]))
      .catch(error => setSaveError(errorMessage(error)))
      .finally(() => {
        eligibilitySavingRef.current = false
        setEligibilitySaving(false)
      })
  }

  const lock =
    visibleStatus?.lock.status === 'none'
      ? visibleStatus.lock.status
      : visibleStatus
        ? `${visibleStatus.lock.status} · ${visibleStatus.lock.endpoint} · ${visibleStatus.lock.providerID}/${visibleStatus.lock.modelID}`
        : ''
  const rows = visibleStatus
    ? [
        [t('compaction.requestedIdentity'), `${visibleStatus.requested.providerID}/${visibleStatus.requested.modelID}`],
        [
          t('compaction.effectiveIdentity'),
          `${visibleStatus.effective.providerID}/${visibleStatus.effective.modelID} · ${visibleStatus.effective.wireModelID}`,
        ],
        [t('compaction.resolvedMode'), `${visibleStatus.mode} · ${visibleStatus.target}`],
        [t('compaction.credential'), visibleStatus.credential],
        [t('compaction.protocolOrder'), visibleStatus.protocols.join(' → ') || t('compaction.none')],
        [t('compaction.localFallback'), String(visibleStatus.localFallback)],
        [t('compaction.reason'), visibleStatus.reason],
        [t('compaction.lock'), lock],
        [t('compaction.replay'), `${visibleStatus.replay.mode} · ${visibleStatus.replay.reason}`],
      ]
    : []

  return (
    <div>
      <SettingsSection title={t('compaction.policy')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('compaction.policyDesc')}</p>
        {visibleStatus ? (
          <>
            <label className="flex flex-col gap-2 text-[length:var(--fs-md)] font-medium text-text-100">
              {t('compaction.configuredPolicy')}
              <select
                aria-label={t('compaction.configuredPolicy')}
                value={visibleStatus.configured.mode}
                disabled={policySaving}
                onChange={event =>
                  void savePolicy({ remote: event.target.value as RemoteCompactionPolicyPatch['remote'] })
                }
                className="rounded-lg border border-border-200 bg-bg-100 px-3 py-2 text-text-100 disabled:opacity-50"
              >
                <option value="auto">{t('compaction.policyAuto')}</option>
                <option value="on">{t('compaction.policyOn')}</option>
                <option value="off">{t('compaction.policyOff')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-[length:var(--fs-md)] font-medium text-text-100">
              {t('compaction.configuredProtocol')}
              <select
                aria-label={t('compaction.configuredProtocol')}
                value={visibleStatus.configured.protocol}
                disabled={policySaving}
                onChange={event =>
                  void savePolicy({
                    remote_protocol: event.target.value as RemoteCompactionPolicyPatch['remote_protocol'],
                  })
                }
                className="rounded-lg border border-border-200 bg-bg-100 px-3 py-2 text-text-100 disabled:opacity-50"
              >
                <option value="auto">{t('compaction.protocolAuto')}</option>
                <option value="v2">{t('compaction.protocolV2')}</option>
                <option value="legacy">{t('compaction.protocolLegacy')}</option>
              </select>
            </label>
          </>
        ) : (
          <p className="text-[length:var(--fs-sm)] text-text-400">
            {isStatusLoading ? t('compaction.loading') : t('compaction.noStatus')}
          </p>
        )}
        {policySaving && (
          <p role="status" className="text-[length:var(--fs-xs)] text-text-400">
            {t('compaction.saving')}
          </p>
        )}
      </SettingsSection>

      <SettingsSection title={t('compaction.eligibility')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('compaction.eligibilityDesc')}</p>
        {isEligibilityLoading && currentEligibility.length === 0 ? (
          <p role="status" className="text-[length:var(--fs-sm)] text-text-400">
            {t('compaction.eligibilityLoading')}
          </p>
        ) : visibleEligibilityError && currentEligibility.length === 0 ? (
          <div role="alert" className="space-y-2 text-[length:var(--fs-sm)]">
            <p className="text-danger-100">
              {t('compaction.eligibilityLoadError', { error: visibleEligibilityError })}
            </p>
            <button
              type="button"
              onClick={() => void loadEligibility()}
              className="text-accent-main-100 hover:underline"
            >
              {t('compaction.retry')}
            </button>
          </div>
        ) : providers.length === 0 ? (
          <p className="text-[length:var(--fs-sm)] text-text-400">{t('compaction.eligibilityEmpty')}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-[length:var(--fs-sm)] font-medium text-text-100">
                {t('compaction.provider')}
                <select
                  aria-label={t('compaction.provider')}
                  value={selectedProviderID}
                  disabled={eligibilitySaving}
                  onChange={event => {
                    const next =
                      currentEligibility.find(item => item.providerID === event.target.value) ??
                      (focused?.providerID === event.target.value ? focused : null)
                    if (next) setSelection({ directory, providerID: next.providerID, modelID: next.modelID })
                  }}
                  className="rounded-lg border border-border-200 bg-bg-100 px-3 py-2 text-text-100 disabled:opacity-50"
                >
                  {providers.map(([providerID, name]) => (
                    <option key={providerID} value={providerID}>
                      {name} · {providerID}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-[length:var(--fs-sm)] font-medium text-text-100">
                {t('compaction.model')}
                <select
                  aria-label={t('compaction.model')}
                  value={selectedIdentity?.modelID ?? ''}
                  disabled={eligibilitySaving}
                  onChange={event => {
                    const next = models.find(item => item.modelID === event.target.value)
                    if (next) setSelection({ directory, providerID: next.providerID, modelID: next.modelID })
                  }}
                  className="rounded-lg border border-border-200 bg-bg-100 px-3 py-2 text-text-100 disabled:opacity-50"
                >
                  {models.map(item => (
                    <option key={item.modelID} value={item.modelID}>
                      {item.modelName} · {item.modelID}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selected ? (
              <div className="space-y-3">
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                  <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">
                    {t('compaction.configurable')}
                  </dt>
                  <dd className="font-mono text-[length:var(--fs-sm)] text-text-100">
                    {selected.configurable ? t('compaction.yes') : t('compaction.no')}
                  </dd>
                  <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">
                    {t('compaction.ordinaryWireApi')}
                  </dt>
                  <dd className="font-mono text-[length:var(--fs-sm)] text-text-100">{selected.wire_api}</dd>
                  <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">
                    {t('compaction.providerCapability')}
                  </dt>
                  <dd className="font-mono text-[length:var(--fs-sm)] text-text-100">
                    {selected.providerCapability.present ? t('compaction.present') : t('compaction.absent')}
                  </dd>
                  <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">
                    {t('compaction.providerProtocols')}
                  </dt>
                  <dd className="font-mono text-[length:var(--fs-sm)] text-text-100">
                    {selected.providerCapability.protocols.join(' → ') || t('compaction.none')}
                  </dd>
                  <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">
                    {t('compaction.modelEligibility')}
                  </dt>
                  <dd className="font-mono text-[length:var(--fs-sm)] text-text-100">
                    {selected.modelRemoteCompaction}
                  </dd>
                </dl>
                {!selected.configurable && (
                  <p className="text-[length:var(--fs-sm)] text-text-400">{t('compaction.notConfigurable')}</p>
                )}
                <div className="space-y-1 text-[length:var(--fs-sm)] text-text-400">
                  <p>{t('compaction.enableBehavior')}</p>
                  <p>{t('compaction.disableBehavior')}</p>
                  <p className="text-warning-100">{t('compaction.endpointWarning')}</p>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex items-center gap-3 text-[length:var(--fs-sm)] font-medium text-text-100">
                    {t('compaction.enableEligibility')}
                    <button
                      type="button"
                      role="switch"
                      aria-label={t('compaction.enableEligibility')}
                      aria-checked={selected.modelRemoteCompaction === 'enabled'}
                      disabled={!selected.configurable || eligibilitySaving}
                      onClick={() => void saveEligibility(selected.modelRemoteCompaction !== 'enabled')}
                      className={`relative h-5 w-9 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${selected.modelRemoteCompaction === 'enabled' ? 'bg-accent-main-100' : 'bg-bg-300'}`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${selected.modelRemoteCompaction === 'enabled' ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                      />
                    </button>
                  </label>
                  <label className="flex min-w-44 flex-col gap-2 text-[length:var(--fs-sm)] font-medium text-text-100">
                    {t('compaction.eligibilityProtocols')}
                    <select
                      aria-label={t('compaction.eligibilityProtocols')}
                      value={protocolChoice}
                      disabled={!selected.configurable || eligibilitySaving}
                      onChange={event =>
                        selectedIdentity &&
                        setProtocolOverrides(current => ({
                          ...current,
                          [selectionKey(selectedIdentity)]: event.target.value as ProtocolChoice,
                        }))
                      }
                      className="rounded-lg border border-border-200 bg-bg-100 px-3 py-2 text-text-100 disabled:opacity-50"
                    >
                      {protocolChoices.map(choice => (
                        <option key={choice} value={choice}>
                          {choice.replace(',', ' → ')}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ) : (
              <p className="text-[length:var(--fs-sm)] text-text-400">{t('compaction.eligibilityUnavailable')}</p>
            )}
            {eligibilitySaving && (
              <p role="status" className="text-[length:var(--fs-xs)] text-text-400">
                {t('compaction.eligibilitySaving')}
              </p>
            )}
          </>
        )}
      </SettingsSection>

      <SettingsSection title={t('compaction.resolvedStatus')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">
          {t('compaction.resolvedStatusDesc', {
            identity: selectedIdentity
              ? `${selectedIdentity.providerID}/${selectedIdentity.modelID}`
              : t('compaction.none'),
          })}
        </p>
        {isStatusLoading ? (
          <p role="status" className="text-[length:var(--fs-sm)] text-text-400">
            {t('compaction.loading')}
          </p>
        ) : visibleStatusError ? (
          <div role="alert" className="space-y-2 text-[length:var(--fs-sm)]">
            <p className="text-danger-100">{t('compaction.loadError', { error: visibleStatusError })}</p>
            <button
              type="button"
              onClick={() => void refreshCurrentStatus()}
              className="text-accent-main-100 hover:underline"
            >
              {t('compaction.retry')}
            </button>
          </div>
        ) : visibleStatus ? (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">{label}</dt>
                <dd className="break-words font-mono text-[length:var(--fs-sm)] text-text-100">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[length:var(--fs-sm)] text-text-400">{t('compaction.noStatus')}</p>
        )}
      </SettingsSection>
      {saveError && (
        <p role="alert" className="px-1 text-[length:var(--fs-sm)] text-danger-100">
          {t('compaction.saveError', { error: saveError })}
        </p>
      )}
    </div>
  )
}

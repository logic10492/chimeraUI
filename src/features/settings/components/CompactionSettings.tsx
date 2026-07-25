import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RemoteCompactionEligibility,
  RemoteCompactionEligibilityPatch,
  RemoteCompactionPolicyPatch,
  RemoteCompactionResolution,
} from '@opencode-ai/sdk/v2'
import type { ApiProject } from '../../../api'
import { getCurrentProject } from '../../../api/client'
import {
  getRemoteCompactionEligibility,
  getRemoteCompactionStatus,
  updateRemoteCompactionEligibility,
  updateRemoteCompactionPolicy,
} from '../../../api/config'
import { CheckIcon, FolderIcon, SpinnerIcon } from '../../../components/Icons'
import { useDirectory } from '../../../contexts/useDirectory'
import { usePaneController } from '../../../store/paneControllerStore'
import { usePaneLayout } from '../../../store/paneLayoutStore'
import { getDirectoryName, isSameDirectory, normalizeForComparison } from '../../../utils'
import { SegmentedControl, SettingsSection } from './SettingsUI'

const protocolChoices = ['v2,legacy', 'v2', 'legacy,v2', 'legacy'] as const
type ProtocolChoice = (typeof protocolChoices)[number]
type Selection = { directory: string; providerID: string; modelID: string }
type StatusIdentity = Selection & { sessionID?: string }
type StatusEntry = { key: string; value: RemoteCompactionResolution }
type PolicyMode = RemoteCompactionResolution['configured']['mode']
type PolicyProtocol = RemoteCompactionResolution['configured']['protocol']
type PolicyDraft = { directory: string; remote: PolicyMode; remote_protocol: PolicyProtocol }
type ProjectScopeEntry = { directory: string; project: ApiProject }
type PolicySaveResult = {
  status: 'saving' | 'success' | 'error'
  directory: string
  projectName: string
  error?: string
}

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
  const { currentDirectory } = useDirectory()
  const directory = controller?.effectiveDirectory || currentDirectory || ''
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
  const [projectScope, setProjectScope] = useState<ProjectScopeEntry | null>(null)
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null)
  const [policySaveResult, setPolicySaveResult] = useState<PolicySaveResult | null>(null)
  const [projectScopeError, setProjectScopeError] = useState<{ directory: string; message: string } | null>(null)
  const [eligibilityError, setEligibilityError] = useState<{ directory: string; message: string } | null>(null)
  const [statusError, setStatusError] = useState<{ key: string; message: string } | null>(null)
  const [eligibilitySaveError, setEligibilitySaveError] = useState<string | null>(null)
  const [projectScopeLoading, setProjectScopeLoading] = useState<string | null>(null)
  const [eligibilityLoading, setEligibilityLoading] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState<string | null>(null)
  const [policySaving, setPolicySaving] = useState(false)
  const [eligibilitySaving, setEligibilitySaving] = useState(false)
  const projectScopeRequestID = useRef(0)
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
  const currentProject = projectScope?.directory === directory ? projectScope.project : null
  const projectName =
    currentProject?.name?.trim() ||
    getDirectoryName(currentProject?.worktree || directory) ||
    t('compaction.scopeUnknown')
  const projectWorktree = currentProject?.worktree || directory
  const normalizedDirectory = normalizeForComparison(directory)
  const matchingSandbox = currentProject?.sandboxes.find(sandbox => {
    const normalizedSandbox = normalizeForComparison(sandbox)
    return (
      normalizedSandbox &&
      (normalizedDirectory === normalizedSandbox || normalizedDirectory.startsWith(`${normalizedSandbox}/`))
    )
  })
  const scopeKind = currentProject
    ? isSameDirectory(directory, currentProject.worktree)
      ? t('compaction.scopeProjectRoot')
      : matchingSandbox
        ? t('compaction.scopeSandbox')
        : t('compaction.scopeSubdirectory')
    : t('compaction.scopeDirectory')
  const visibleProjectScopeError = projectScopeError?.directory === directory ? projectScopeError.message : null
  const isProjectScopeLoading = projectScopeLoading === directory
  const activePolicyDraft = policyDraft?.directory === directory ? policyDraft : null
  const policyMode = activePolicyDraft?.remote ?? visibleStatus?.configured.mode ?? 'auto'
  const policyProtocol = activePolicyDraft?.remote_protocol ?? visibleStatus?.configured.protocol ?? 'auto'
  const policyDirty =
    !!visibleStatus &&
    (policyMode !== visibleStatus.configured.mode || policyProtocol !== visibleStatus.configured.protocol)
  const visiblePolicySaveResult = policySaveResult?.directory === directory ? policySaveResult : null
  const eligibilityState = selected ? t(`compaction.eligibilityStates.${selected.modelRemoteCompaction}`) : ''
  const eligibilityStateClass =
    selected?.modelRemoteCompaction === 'enabled'
      ? 'text-success-100'
      : selected?.modelRemoteCompaction === 'unset'
        ? 'text-warning-100'
        : 'text-text-100'

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

  const loadProjectScope = useCallback(async (targetDirectory = currentDirectoryRef.current) => {
    if (!targetDirectory) return
    const request = ++projectScopeRequestID.current
    setProjectScopeError(null)
    setProjectScopeLoading(targetDirectory)
    return getCurrentProject(targetDirectory)
      .then(project => {
        if (request !== projectScopeRequestID.current || currentDirectoryRef.current !== targetDirectory) return
        setProjectScope({ directory: targetDirectory, project })
      })
      .catch(error => {
        if (request !== projectScopeRequestID.current || currentDirectoryRef.current !== targetDirectory) return
        setProjectScopeError({ directory: targetDirectory, message: errorMessage(error) })
      })
      .finally(() => {
        if (request === projectScopeRequestID.current) setProjectScopeLoading(null)
      })
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      if (currentDirectoryRef.current !== directory) return
      setPolicyDraft(null)
      setPolicySaveResult(null)
      void loadProjectScope(directory)
      void loadEligibility(directory)
    })
  }, [directory, loadEligibility, loadProjectScope])

  useEffect(() => {
    queueMicrotask(() => void requestStatus(currentIdentityRef.current))
  }, [currentStatusKey, requestStatus])

  const updatePolicyDraft = (patch: Partial<Omit<PolicyDraft, 'directory'>>) => {
    if (!directory || !visibleStatus) return
    setPolicySaveResult(null)
    setPolicyDraft(current => ({
      ...(current?.directory === directory
        ? current
        : {
            directory,
            remote: visibleStatus.configured.mode,
            remote_protocol: visibleStatus.configured.protocol,
          }),
      ...patch,
    }))
  }

  const savePolicy = async () => {
    if (policySavingRef.current || !directory || !visibleStatus || !policyDirty) return
    const targetDirectory = directory
    const targetProjectName = projectName
    const patch: RemoteCompactionPolicyPatch = {
      ...(policyMode !== visibleStatus.configured.mode ? { remote: policyMode } : {}),
      ...(policyProtocol !== visibleStatus.configured.protocol ? { remote_protocol: policyProtocol } : {}),
    }
    policySavingRef.current = true
    setPolicySaving(true)
    setPolicySaveResult({ status: 'saving', directory: targetDirectory, projectName: targetProjectName })
    return updateRemoteCompactionPolicy(patch, undefined, targetDirectory)
      .then(() => refreshCurrentStatus())
      .then(() => {
        setPolicyDraft(current => (current?.directory === targetDirectory ? null : current))
        setPolicySaveResult({ status: 'success', directory: targetDirectory, projectName: targetProjectName })
      })
      .catch(error =>
        setPolicySaveResult({
          status: 'error',
          directory: targetDirectory,
          projectName: targetProjectName,
          error: errorMessage(error),
        }),
      )
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
    setEligibilitySaveError(null)
    const patch: RemoteCompactionEligibilityPatch = {
      providerID: selected.providerID,
      modelID: selected.modelID,
      enabled,
      ...(enabled ? { protocols: protocolsFor(protocolChoice) } : {}),
    }
    return updateRemoteCompactionEligibility(patch, targetDirectory)
      .then(() => Promise.all([loadEligibility(currentDirectoryRef.current), refreshCurrentStatus()]))
      .catch(error => setEligibilitySaveError(errorMessage(error)))
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
        [t('compaction.reason'), t(`compaction.reasons.${visibleStatus.reason}`)],
        [t('compaction.lock'), lock],
        [t('compaction.replay'), `${visibleStatus.replay.mode} · ${visibleStatus.replay.reason}`],
      ]
    : []

  return (
    <div>
      <section aria-labelledby="compaction-scope-title" className="mb-7 border-b border-border-200/50 pb-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <FolderIcon size={18} className="mt-0.5 shrink-0 text-text-400" />
            <div className="min-w-0">
              <p id="compaction-scope-title" className="text-[length:var(--fs-xs)] font-medium text-text-400">
                {t('compaction.scopeTitle')}
              </p>
              <h2 className="mt-0.5 text-[length:var(--fs-base)] font-semibold text-text-100">{projectName}</h2>
            </div>
          </div>
          <span className="rounded-md border border-border-200 bg-bg-100 px-2 py-1 text-[length:var(--fs-xs)] font-medium text-text-300">
            {scopeKind}
          </span>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[length:var(--fs-xs)] text-text-400">{t('compaction.scopeProjectWorktree')}</dt>
            <dd className="mt-1 break-all font-mono text-[length:var(--fs-sm)] text-text-100">
              {projectWorktree || t('compaction.scopeUnavailable')}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[length:var(--fs-xs)] text-text-400">{t('compaction.scopeDirectoryLabel')}</dt>
            <dd className="mt-1 break-all font-mono text-[length:var(--fs-sm)] text-text-100">
              {directory || t('compaction.scopeUnavailable')}
            </dd>
          </div>
        </dl>
        {isProjectScopeLoading && (
          <p role="status" className="mt-3 text-[length:var(--fs-xs)] text-text-400">
            {t('compaction.scopeLoading')}
          </p>
        )}
        {visibleProjectScopeError && (
          <p role="alert" className="mt-3 text-[length:var(--fs-xs)] text-warning-100">
            {t('compaction.scopeLoadError', { error: visibleProjectScopeError })}
          </p>
        )}
      </section>

      <SettingsSection title={t('compaction.policy')}>
        <p className="text-[length:var(--fs-sm)] text-text-400">{t('compaction.policyDesc')}</p>
        {visibleStatus ? (
          <>
            <div className="grid gap-4 border-y border-border-200/50 py-4 sm:grid-cols-2">
              <div>
                <p className="text-[length:var(--fs-xs)] font-medium text-text-400">
                  {t('compaction.savedPolicyIntent')}
                </p>
                <p className="mt-1 text-[length:var(--fs-md)] font-semibold text-text-100">
                  {t(`compaction.policyIntents.${visibleStatus.configured.mode}`)}
                </p>
              </div>
              <div>
                <p className="text-[length:var(--fs-xs)] font-medium text-text-400">
                  {t('compaction.effectiveResult')}
                </p>
                <p
                  className={`mt-1 flex items-center gap-2 text-[length:var(--fs-md)] font-semibold ${
                    visibleStatus.mode === 'remote' ? 'text-success-100' : 'text-warning-100'
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-current" />
                  {visibleStatus.mode === 'remote' ? t('compaction.effectiveRemote') : t('compaction.effectiveLocal')}
                </p>
                <p className="mt-1 break-words text-[length:var(--fs-xs)] text-text-400">
                  {t('compaction.effectiveFor', {
                    identity: `${visibleStatus.requested.providerID}/${visibleStatus.requested.modelID}`,
                  })}
                </p>
                <p className="mt-1 break-words text-[length:var(--fs-xs)] text-text-400">
                  {t(`compaction.reasons.${visibleStatus.reason}`)}
                  {visibleStatus.protocols.length > 0 ? ` · ${visibleStatus.protocols.join(' → ')}` : ''}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <fieldset disabled={policySaving || !directory} className={policySaving ? 'opacity-60' : ''}>
                <legend className="mb-2 text-[length:var(--fs-md)] font-medium text-text-100">
                  {t('compaction.configuredPolicy')}
                </legend>
                <SegmentedControl
                  value={policyMode}
                  options={[
                    { value: 'auto', label: t('compaction.policyAuto') },
                    { value: 'on', label: t('compaction.policyOn') },
                    { value: 'off', label: t('compaction.policyOff') },
                  ]}
                  onChange={remote => updatePolicyDraft({ remote })}
                />
              </fieldset>
              <fieldset disabled={policySaving || !directory} className={policySaving ? 'opacity-60' : ''}>
                <legend className="mb-2 text-[length:var(--fs-md)] font-medium text-text-100">
                  {t('compaction.configuredProtocol')}
                </legend>
                <SegmentedControl
                  value={policyProtocol}
                  options={[
                    { value: 'auto', label: t('compaction.protocolAuto') },
                    { value: 'v2', label: t('compaction.protocolV2') },
                    { value: 'legacy', label: t('compaction.protocolLegacy') },
                  ]}
                  onChange={remote_protocol => updatePolicyDraft({ remote_protocol })}
                />
              </fieldset>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p
                aria-live="polite"
                className={`min-h-5 text-[length:var(--fs-xs)] ${policyDirty ? 'text-warning-100' : 'text-text-400'}`}
              >
                {policyDirty ? t('compaction.unsavedPolicy') : t('compaction.policyUpToDate')}
              </p>
              <button
                type="button"
                disabled={!policyDirty || policySaving || !directory}
                aria-busy={policySaving}
                onClick={() => void savePolicy()}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-accent-main-100 px-3 py-2 text-[length:var(--fs-sm)] font-medium text-white transition-colors hover:bg-accent-main-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {policySaving ? <SpinnerIcon size={14} className="animate-spin" /> : <CheckIcon size={14} />}
                {visiblePolicySaveResult?.status === 'saving'
                  ? t('compaction.savingToProject', { project: visiblePolicySaveResult.projectName })
                  : t('compaction.applyPolicy', { project: projectName })}
              </button>
            </div>
            {visiblePolicySaveResult?.status === 'success' && (
              <p role="status" className="text-[length:var(--fs-xs)] text-success-100">
                {t('compaction.savedToScope', {
                  project: visiblePolicySaveResult.projectName,
                  directory: visiblePolicySaveResult.directory,
                })}
              </p>
            )}
            {visiblePolicySaveResult?.status === 'error' && (
              <p role="alert" className="text-[length:var(--fs-xs)] text-danger-100">
                {t('compaction.saveToScopeError', {
                  project: visiblePolicySaveResult.projectName,
                  directory: visiblePolicySaveResult.directory,
                  error: visiblePolicySaveResult.error,
                })}
              </p>
            )}
          </>
        ) : (
          <p className="text-[length:var(--fs-sm)] text-text-400">
            {isStatusLoading ? t('compaction.loading') : t('compaction.noStatus')}
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
                  <dd className={`font-mono text-[length:var(--fs-sm)] ${eligibilityStateClass}`}>
                    {eligibilityState}
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
      {eligibilitySaveError && (
        <p role="alert" className="px-1 text-[length:var(--fs-sm)] text-danger-100">
          {t('compaction.saveError', { error: eligibilitySaveError })}
        </p>
      )}
    </div>
  )
}

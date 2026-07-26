import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RemoteCompactionEligibility,
  RemoteCompactionEligibilityPatch,
  RemoteCompactionPolicyPatch,
  RemoteCompactionResolution,
  RemoteCompactionValueMetadata,
} from '../../../types/api/config'
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
import { useServerStore } from '../../../hooks/useServerStore'
import { usePaneController } from '../../../store/paneControllerStore'
import { usePaneLayout } from '../../../store/paneLayoutStore'
import { isSameDirectory, normalizeForComparison } from '../../../utils'
import { SegmentedControl, SettingsSection } from './SettingsUI'

const protocolChoices = ['v2,legacy', 'v2', 'legacy,v2', 'legacy'] as const
type ProtocolChoice = (typeof protocolChoices)[number]
type ServerScope = { serverID: string; directory: string }
type Selection = ServerScope & { providerID: string; modelID: string }
type StatusIdentity = Selection & { sessionID?: string }
type PolicyMode = RemoteCompactionResolution['configured']['mode']
type PolicyProtocol = RemoteCompactionResolution['configured']['protocol']
type PolicyDraft = ServerScope & { remote: PolicyMode; remote_protocol: PolicyProtocol }
type ProjectScopeEntry = ServerScope & { project: ApiProject }
type PolicySaveResult = {
  status: 'saving' | 'write-error' | 'refresh-error' | 'success'
  serverID: string
  directory: string
  scopeLabel: string
  identity: StatusIdentity
  error?: string
}
type EligibilitySaveResult = {
  status: 'saving' | 'write-error' | 'refresh-error' | 'success'
  key: string
  serverID: string
  directory: string
  providerID: string
  modelID: string
  error?: string
  refreshFailure?: 'eligibility' | 'status' | 'both'
}
type RefreshResult = 'success' | 'error'
type RefreshRequest = { id: number; result: Promise<RefreshResult> }

const policyDraftStore = new Map<string, PolicyDraft>()

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function scopeKey(identity: ServerScope) {
  return `${identity.serverID}\u0000${identity.directory}`
}

function selectionKey(identity: Pick<Selection, 'serverID' | 'directory' | 'providerID' | 'modelID'>) {
  return `${scopeKey(identity)}\u0000${identity.providerID}\u0000${identity.modelID}`
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
  const { activeServer } = useServerStore()
  const serverID = activeServer?.id ?? ''
  const directory = controller?.effectiveDirectory || currentDirectory || ''
  const currentScope = useMemo(() => ({ serverID, directory }), [directory, serverID])
  const currentScopeKey = scopeKey(currentScope)
  const focused = useMemo(
    () =>
      controller?.currentProviderId && controller.currentModelId
        ? { serverID, directory, providerID: controller.currentProviderId, modelID: controller.currentModelId }
        : null,
    [controller?.currentModelId, controller?.currentProviderId, directory, serverID],
  )
  const [eligibilityByScope, setEligibilityByScope] = useState<Record<string, RemoteCompactionEligibility[]>>({})
  const [selection, setSelection] = useState<Selection | null>(null)
  const [protocolOverrides, setProtocolOverrides] = useState<Record<string, ProtocolChoice>>({})
  const [statusByKey, setStatusByKey] = useState<Record<string, RemoteCompactionResolution>>({})
  const [projectScopeByScope, setProjectScopeByScope] = useState<Record<string, ProjectScopeEntry>>({})
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(
    () => policyDraftStore.get(currentScopeKey) ?? null,
  )
  const [policySaveResults, setPolicySaveResults] = useState<Record<string, PolicySaveResult>>({})
  const [eligibilitySaveResults, setEligibilitySaveResults] = useState<Record<string, EligibilitySaveResult>>({})
  const [projectScopeErrors, setProjectScopeErrors] = useState<Record<string, string>>({})
  const [eligibilityErrors, setEligibilityErrors] = useState<Record<string, string>>({})
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({})
  const [projectScopeLoading, setProjectScopeLoading] = useState<Record<string, boolean>>({})
  const [eligibilityLoading, setEligibilityLoading] = useState<Record<string, boolean>>({})
  const [statusLoading, setStatusLoading] = useState<Record<string, boolean>>({})
  const [policySaving, setPolicySaving] = useState<Record<string, boolean>>({})
  const [eligibilitySaving, setEligibilitySaving] = useState<Record<string, boolean>>({})
  const projectScopeRequestIDs = useRef(new Map<string, number>())
  const eligibilityRequests = useRef(new Map<string, RefreshRequest>())
  const statusRequests = useRef(new Map<string, RefreshRequest>())
  const policySavingScopes = useRef(new Set<string>())
  const currentScopeRef = useRef(currentScope)
  const currentIdentityRef = useRef<StatusIdentity | null>(null)
  const focusedRef = useRef(focused)

  const currentEligibility = useMemo(
    () => eligibilityByScope[currentScopeKey] ?? [],
    [currentScopeKey, eligibilityByScope],
  )
  const currentSelection = selection && scopeKey(selection) === currentScopeKey ? selection : null
  const selectedIdentity =
    currentSelection ??
    focused ??
    (currentEligibility[0]
      ? {
          serverID,
          directory,
          providerID: currentEligibility[0].providerID,
          modelID: currentEligibility[0].modelID,
        }
      : null)
  const selected = selectedIdentity
    ? currentEligibility.find(
        item => item.providerID === selectedIdentity.providerID && item.modelID === selectedIdentity.modelID,
      )
    : undefined
  const currentStatusIdentity = selectedIdentity
    ? {
        ...selectedIdentity,
        ...(focused && selectionKey(selectedIdentity) === selectionKey(focused) && controller?.sessionId
          ? { sessionID: controller.sessionId }
          : {}),
      }
    : null
  const currentStatusKey = currentStatusIdentity ? statusKey(currentStatusIdentity) : ''
  const visibleStatus = statusByKey[currentStatusKey] ?? null
  const visibleStatusError = statusErrors[currentStatusKey] ?? null
  const isStatusLoading = !!statusLoading[currentStatusKey]
  const isEligibilityLoading = !!eligibilityLoading[currentScopeKey]
  const visibleEligibilityError = eligibilityErrors[currentScopeKey] ?? null
  const currentProject = projectScopeByScope[currentScopeKey]?.project ?? null
  const projectName = currentProject?.name?.trim() || t('compaction.scopeUnknown')
  const projectWorktree = currentProject?.worktree || ''
  const scopeLabel = currentProject?.name?.trim() || directory || t('compaction.scopeUnknown')
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
  const visibleProjectScopeError = projectScopeErrors[currentScopeKey] ?? null
  const isProjectScopeLoading = !!projectScopeLoading[currentScopeKey]
  const activePolicyDraft = policyDraft && scopeKey(policyDraft) === currentScopeKey ? policyDraft : null
  const policyMode = activePolicyDraft?.remote ?? visibleStatus?.configured.mode ?? 'auto'
  const policyProtocol = activePolicyDraft?.remote_protocol ?? visibleStatus?.configured.protocol ?? 'auto'
  const policyDirty =
    !!visibleStatus &&
    (policyMode !== visibleStatus.configured.mode || policyProtocol !== visibleStatus.configured.protocol)
  const visiblePolicySaveResult = policySaveResults[currentScopeKey] ?? null
  const selectedEligibilityKey = selectedIdentity ? selectionKey(selectedIdentity) : ''
  const visibleEligibilitySaveResult = eligibilitySaveResults[selectedEligibilityKey] ?? null
  const isPolicySaving = !!policySaving[currentScopeKey]
  const isEligibilitySaving = !!eligibilitySaving[selectedEligibilityKey]
  const eligibilityState = selected ? t(`compaction.eligibilityStates.${selected.modelRemoteCompaction}`) : ''
  const eligibilityStateClass =
    selected?.modelRemoteCompaction === 'enabled'
      ? 'text-success-100'
      : selected?.modelRemoteCompaction === 'unset'
        ? 'text-warning-100'
        : 'text-text-100'

  const policyMetadata = visibleStatus?.configured.metadata
  const policyHasProjectOverride =
    !!policyMetadata &&
    (policyMetadata.remote.explicitAtWriteTarget || policyMetadata.remote_protocol.explicitAtWriteTarget)
  const eligibilityHasProjectOverride = !!selected?.metadata?.modelRemoteCompaction.explicitAtWriteTarget
  const provenanceDetail = (metadata: RemoteCompactionValueMetadata | undefined) =>
    metadata
      ? `${t(`compaction.sources.${metadata.source}`)} (${metadata.source}) · ${
          metadata.explicitAtWriteTarget ? t('compaction.explicitOverride') : t('compaction.inheritedValue')
        }`
      : t('compaction.provenanceUnavailable')
  const writeTargetDetail = (metadata: { format: 'json' | 'jsonc'; exists: boolean } | undefined) =>
    metadata
      ? `${t('compaction.projectWriteTarget')} · ${metadata.format} · ${
          metadata.exists ? t('compaction.writeTargetExists') : t('compaction.writeTargetMissing')
        }`
      : t('compaction.provenanceUnavailable')

  currentScopeRef.current = currentScope
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

  const requestStatus = useCallback(async (identity: StatusIdentity | null): Promise<RefreshResult> => {
    if (!identity || !identity.serverID || !identity.directory) return 'error'
    const key = statusKey(identity)
    const request = (statusRequests.current.get(key)?.id ?? 0) + 1
    setStatusErrors(current => {
      const { [key]: _discarded, ...rest } = current
      return rest
    })
    setStatusLoading(current => ({ ...current, [key]: true }))
    const result: Promise<RefreshResult> = getRemoteCompactionStatus(
      {
        providerID: identity.providerID,
        modelID: identity.modelID,
        ...(identity.sessionID ? { sessionID: identity.sessionID } : {}),
      },
      { serverID: identity.serverID, directory: identity.directory },
    )
      .then(async value => {
        const latest = statusRequests.current.get(key)
        if (latest?.id !== request) return latest?.result ?? 'error'
        setStatusByKey(current => ({ ...current, [key]: value }))
        const receiptKey = selectionKey(identity)
        setEligibilitySaveResults(current => {
          const receipt = current[receiptKey]
          if (!receipt || receipt.status !== 'refresh-error') return current
          if (receipt.refreshFailure === 'status')
            return {
              ...current,
              [receiptKey]: { ...receipt, status: 'success', refreshFailure: undefined, error: undefined },
            }
          if (receipt.refreshFailure === 'both')
            return { ...current, [receiptKey]: { ...receipt, refreshFailure: 'eligibility' } }
          return current
        })
        return 'success'
      })
      .catch(async error => {
        const latest = statusRequests.current.get(key)
        if (latest?.id !== request) return latest?.result ?? 'error'
        setStatusErrors(current => ({ ...current, [key]: errorMessage(error) }))
        return 'error'
      })
      .finally(() => {
        if (statusRequests.current.get(key)?.id !== request) return
        setStatusLoading(current => ({ ...current, [key]: false }))
      })
    statusRequests.current.set(key, { id: request, result })
    return result
  }, [])

  const refreshCurrentStatus = useCallback(() => requestStatus(currentIdentityRef.current), [requestStatus])

  const loadEligibility = useCallback(async (target = currentScopeRef.current): Promise<RefreshResult> => {
    if (!target.serverID || !target.directory) return 'error'
    const key = scopeKey(target)
    const request = (eligibilityRequests.current.get(key)?.id ?? 0) + 1
    setEligibilityErrors(current => {
      const { [key]: _discarded, ...rest } = current
      return rest
    })
    setEligibilityLoading(current => ({ ...current, [key]: true }))
    const result: Promise<RefreshResult> = getRemoteCompactionEligibility(target)
      .then(async response => {
        const latest = eligibilityRequests.current.get(key)
        if (latest?.id !== request) return latest?.result ?? 'error'
        setEligibilityByScope(current => ({ ...current, [key]: response.items }))
        setEligibilitySaveResults(current =>
          Object.fromEntries(
            Object.entries(current).map(([receiptKey, receipt]) => [
              receiptKey,
              scopeKey(receipt) === key && receipt.status === 'refresh-error'
                ? receipt.refreshFailure === 'eligibility'
                  ? { ...receipt, status: 'success' as const, refreshFailure: undefined, error: undefined }
                  : receipt.refreshFailure === 'both'
                    ? { ...receipt, refreshFailure: 'status' as const }
                    : receipt
                : receipt,
            ]),
          ),
        )
        if (scopeKey(currentScopeRef.current) !== key) return 'success'
        setSelection(current => {
          if (
            current &&
            scopeKey(current) === key &&
            response.items.some(item => item.providerID === current.providerID && item.modelID === current.modelID)
          )
            return current
          const currentFocused = focusedRef.current && scopeKey(focusedRef.current) === key ? focusedRef.current : null
          if (currentFocused) return currentFocused
          const first = response.items.find(item => item.configurable) ?? response.items[0]
          return first ? { ...target, providerID: first.providerID, modelID: first.modelID } : null
        })
        return 'success'
      })
      .catch(async error => {
        const latest = eligibilityRequests.current.get(key)
        if (latest?.id !== request) return latest?.result ?? 'error'
        setEligibilityErrors(current => ({ ...current, [key]: errorMessage(error) }))
        return 'error'
      })
      .finally(() => {
        if (eligibilityRequests.current.get(key)?.id !== request) return
        setEligibilityLoading(current => ({ ...current, [key]: false }))
      })
    eligibilityRequests.current.set(key, { id: request, result })
    return result
  }, [])

  const loadProjectScope = useCallback(async (target = currentScopeRef.current) => {
    if (!target.serverID || !target.directory) return false
    const key = scopeKey(target)
    const request = (projectScopeRequestIDs.current.get(key) ?? 0) + 1
    projectScopeRequestIDs.current.set(key, request)
    setProjectScopeErrors(current => {
      const { [key]: _discarded, ...rest } = current
      return rest
    })
    setProjectScopeLoading(current => ({ ...current, [key]: true }))
    return getCurrentProject(target)
      .then(project => {
        if (projectScopeRequestIDs.current.get(key) !== request) return false
        setProjectScopeByScope(current => ({ ...current, [key]: { ...target, project } }))
        return true
      })
      .catch(error => {
        if (projectScopeRequestIDs.current.get(key) !== request) return false
        setProjectScopeErrors(current => ({ ...current, [key]: errorMessage(error) }))
        return false
      })
      .finally(() => {
        if (projectScopeRequestIDs.current.get(key) !== request) return
        setProjectScopeLoading(current => ({ ...current, [key]: false }))
      })
  }, [])

  useEffect(() => {
    const target = currentScope
    const key = currentScopeKey
    queueMicrotask(() => {
      if (scopeKey(currentScopeRef.current) !== key) return
      setPolicyDraft(policyDraftStore.get(key) ?? null)
      void loadProjectScope(target)
      void loadEligibility(target)
    })
  }, [currentScope, currentScopeKey, loadEligibility, loadProjectScope])

  useEffect(() => {
    queueMicrotask(() => void requestStatus(currentIdentityRef.current))
  }, [currentStatusKey, requestStatus])

  const updatePolicyDraft = (patch: Partial<Omit<PolicyDraft, 'serverID' | 'directory'>>) => {
    if (!serverID || !directory || !visibleStatus) return
    setPolicySaveResults(current => {
      const { [currentScopeKey]: _discarded, ...rest } = current
      return rest
    })
    setPolicyDraft(current => {
      const next = {
        ...(current && scopeKey(current) === currentScopeKey
          ? current
          : {
              serverID,
              directory,
              remote: visibleStatus.configured.mode,
              remote_protocol: visibleStatus.configured.protocol,
            }),
        ...patch,
      }
      policyDraftStore.set(currentScopeKey, next)
      return next
    })
  }

  const withPolicySaving = (key: string, action: () => Promise<void>) => {
    if (policySavingScopes.current.has(key)) return
    policySavingScopes.current.add(key)
    setPolicySaving(current => ({ ...current, [key]: true }))
    return action().finally(() => {
      policySavingScopes.current.delete(key)
      setPolicySaving(current => ({ ...current, [key]: false }))
    })
  }

  const confirmPolicyRefresh = async (result: PolicySaveResult) => {
    const key = scopeKey(result)
    setPolicySaveResults(current => ({
      ...current,
      [key]: { ...result, status: 'saving', error: undefined },
    }))
    const [refreshed] = await Promise.all([
      requestStatus(result.identity),
      loadEligibility({ serverID: result.serverID, directory: result.directory }),
    ])
    if (refreshed === 'error') {
      setPolicySaveResults(current => ({
        ...current,
        [key]: { ...result, status: 'refresh-error', error: undefined },
      }))
      return
    }
    policyDraftStore.delete(key)
    setPolicyDraft(current => (current && scopeKey(current) === key ? null : current))
    setPolicySaveResults(current => ({
      ...current,
      [key]: { ...result, status: 'success', error: undefined },
    }))
  }

  const retryPolicyRefresh = (result: PolicySaveResult) =>
    withPolicySaving(scopeKey(result), () => confirmPolicyRefresh(result))

  const submitPolicy = async (patch: RemoteCompactionPolicyPatch) => {
    if (
      !serverID ||
      !directory ||
      !visibleStatus ||
      !currentStatusIdentity ||
      policySavingScopes.current.has(currentScopeKey)
    )
      return
    const target = currentScope
    const result: PolicySaveResult = {
      status: 'saving',
      ...target,
      scopeLabel,
      identity: currentStatusIdentity,
    }
    return withPolicySaving(currentScopeKey, () => {
      setPolicySaveResults(current => ({ ...current, [currentScopeKey]: result }))
      return updateRemoteCompactionPolicy(patch, undefined, target)
        .then(() => confirmPolicyRefresh(result))
        .catch(error =>
          setPolicySaveResults(current => ({
            ...current,
            [currentScopeKey]: { ...result, status: 'write-error', error: errorMessage(error) },
          })),
        )
    })
  }

  const savePolicy = () => {
    if (!visibleStatus || !policyDirty) return
    return submitPolicy({
      ...(policyMode !== visibleStatus.configured.mode ? { remote: policyMode } : {}),
      ...(policyProtocol !== visibleStatus.configured.protocol ? { remote_protocol: policyProtocol } : {}),
    })
  }

  const resetPolicy = () => {
    if (!policyHasProjectOverride) return
    return submitPolicy({ remote: null, remote_protocol: null })
  }

  const saveEligibility = async (enabled: boolean | null) => {
    if (!selected?.configurable || !selectedIdentity || eligibilitySaving[selectedEligibilityKey]) return
    const target = { ...selectedIdentity }
    const key = selectionKey(target)
    const statusIdentity =
      currentStatusIdentity && selectionKey(currentStatusIdentity) === key ? currentStatusIdentity : target
    const result: EligibilitySaveResult = {
      status: 'saving',
      key,
      serverID: target.serverID,
      directory: target.directory,
      providerID: target.providerID,
      modelID: target.modelID,
    }
    const patch: RemoteCompactionEligibilityPatch = {
      providerID: selected.providerID,
      modelID: selected.modelID,
      enabled,
      ...(enabled ? { protocols: protocolsFor(protocolChoice) } : {}),
    }
    setEligibilitySaving(current => ({ ...current, [key]: true }))
    setEligibilitySaveResults(current => ({ ...current, [key]: result }))
    return updateRemoteCompactionEligibility(patch, { serverID: target.serverID, directory: target.directory })
      .then(async () => {
        const [eligibilityRefreshed, statusRefreshed] = await Promise.all([
          loadEligibility(target),
          requestStatus(statusIdentity),
        ])
        const refreshFailure: EligibilitySaveResult['refreshFailure'] =
          eligibilityRefreshed === 'error'
            ? statusRefreshed === 'error'
              ? 'both'
              : 'eligibility'
            : statusRefreshed === 'error'
              ? 'status'
              : undefined
        setEligibilitySaveResults(current => ({
          ...current,
          [key]: {
            ...result,
            status: refreshFailure ? 'refresh-error' : 'success',
            refreshFailure,
          },
        }))
      })
      .catch(error =>
        setEligibilitySaveResults(current => ({
          ...current,
          [key]: { ...result, status: 'write-error', error: errorMessage(error) },
        })),
      )
      .finally(() => setEligibilitySaving(current => ({ ...current, [key]: false })))
  }

  const rawDetail = (group: string, value: string) => `${t(`compaction.details.${group}.${value}`)} (${value})`
  const lock = visibleStatus
    ? visibleStatus.lock.status === 'none'
      ? rawDetail('lock', visibleStatus.lock.status)
      : `${rawDetail('lock', visibleStatus.lock.status)} · ${rawDetail('target', visibleStatus.lock.endpoint)} · ${visibleStatus.lock.providerID}/${visibleStatus.lock.modelID}`
    : ''
  const rows = visibleStatus
    ? [
        [t('compaction.requestedIdentity'), `${visibleStatus.requested.providerID}/${visibleStatus.requested.modelID}`],
        [
          t('compaction.effectiveIdentity'),
          `${visibleStatus.effective.providerID}/${visibleStatus.effective.modelID} · ${visibleStatus.effective.wireModelID}`,
        ],
        [
          t('compaction.resolvedMode'),
          `${rawDetail('mode', visibleStatus.mode)} · ${rawDetail('target', visibleStatus.target)}`,
        ],
        [t('compaction.credential'), rawDetail('credential', visibleStatus.credential)],
        [t('compaction.protocolOrder'), visibleStatus.protocols.join(' → ') || t('compaction.none')],
        [t('compaction.localFallback'), String(visibleStatus.localFallback)],
        [t('compaction.reason'), `${t(`compaction.reasons.${visibleStatus.reason}`)} (${visibleStatus.reason})`],
        [t('compaction.lock'), lock],
        [
          t('compaction.replay'),
          `${rawDetail('replayMode', visibleStatus.replay.mode)} · ${rawDetail('replayReason', visibleStatus.replay.reason)}`,
        ],
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
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span className="rounded-md border border-border-200 bg-bg-100 px-2 py-1 text-[length:var(--fs-xs)] font-medium text-text-300">
              {scopeKind}
            </span>
            <button
              type="button"
              onClick={() => void loadProjectScope(currentScope)}
              aria-busy={isProjectScopeLoading}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-[length:var(--fs-xs)] font-medium text-accent-main-100 hover:bg-bg-100"
            >
              {t('compaction.refreshScope')}
            </button>
          </div>
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
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-[length:var(--fs-xs)]">
            <p className="min-w-0 break-words text-warning-100">
              {t('compaction.scopeLoadError', { error: visibleProjectScopeError })}
            </p>
            <button
              type="button"
              onClick={() => void loadProjectScope(currentScope)}
              className="min-h-11 shrink-0 text-accent-main-100 hover:underline"
            >
              {t('compaction.retry')}
            </button>
          </div>
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

            <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">{t('compaction.policySource')}</dt>
              <dd className="min-w-0 break-words font-mono text-[length:var(--fs-sm)] text-text-100">
                {provenanceDetail(policyMetadata?.remote)}
              </dd>
              <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">
                {t('compaction.policyProtocolSource')}
              </dt>
              <dd className="min-w-0 break-words font-mono text-[length:var(--fs-sm)] text-text-100">
                {provenanceDetail(policyMetadata?.remote_protocol)}
              </dd>
              <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">
                {t('compaction.policyWriteTarget')}
              </dt>
              <dd className="min-w-0 break-words font-mono text-[length:var(--fs-sm)] text-text-100">
                {writeTargetDetail(policyMetadata?.writeTarget)}
              </dd>
            </dl>

            <div className="space-y-4">
              <fieldset disabled={isPolicySaving || !directory} className={isPolicySaving ? 'opacity-60' : ''}>
                <legend
                  id="compaction-policy-mode"
                  className="mb-2 text-[length:var(--fs-md)] font-medium text-text-100"
                >
                  {t('compaction.configuredPolicy')}
                </legend>
                <SegmentedControl
                  value={policyMode}
                  options={[
                    { value: 'auto', label: t('compaction.policyAuto') },
                    { value: 'on', label: t('compaction.policyOn') },
                    { value: 'off', label: t('compaction.policyOff') },
                  ]}
                  ariaLabelledBy="compaction-policy-mode"
                  onChange={remote => updatePolicyDraft({ remote })}
                />
              </fieldset>
              <fieldset disabled={isPolicySaving || !directory} className={isPolicySaving ? 'opacity-60' : ''}>
                <legend
                  id="compaction-policy-protocol"
                  className="mb-2 text-[length:var(--fs-md)] font-medium text-text-100"
                >
                  {t('compaction.configuredProtocol')}
                </legend>
                <SegmentedControl
                  value={policyProtocol}
                  options={[
                    { value: 'auto', label: t('compaction.protocolAuto') },
                    { value: 'v2', label: t('compaction.protocolV2') },
                    { value: 'legacy', label: t('compaction.protocolLegacy') },
                  ]}
                  ariaLabelledBy="compaction-policy-protocol"
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={!policyHasProjectOverride || isPolicySaving || !directory}
                  onClick={() => void resetPolicy()}
                  className="inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-[length:var(--fs-sm)] font-medium text-accent-main-100 hover:bg-bg-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('compaction.restorePolicyInheritance')}
                </button>
                <button
                  type="button"
                  disabled={!policyDirty || isPolicySaving || !directory}
                  aria-busy={isPolicySaving}
                  onClick={() => void savePolicy()}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent-main-100 px-3 py-2 text-[length:var(--fs-sm)] font-medium text-white transition-colors hover:bg-accent-main-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPolicySaving ? <SpinnerIcon size={14} className="animate-spin" /> : <CheckIcon size={14} />}
                  {visiblePolicySaveResult?.status === 'saving'
                    ? t('compaction.savingToScope', { scope: visiblePolicySaveResult.scopeLabel })
                    : t('compaction.applyPolicy', { scope: scopeLabel })}
                </button>
              </div>
            </div>
            {visiblePolicySaveResult?.status === 'success' && (
              <p role="status" className="break-words text-[length:var(--fs-xs)] text-success-100">
                {t('compaction.savedToScope', {
                  scope: visiblePolicySaveResult.scopeLabel,
                  directory: visiblePolicySaveResult.directory,
                })}
              </p>
            )}
            {visiblePolicySaveResult?.status === 'write-error' && (
              <p role="alert" className="break-words text-[length:var(--fs-xs)] text-danger-100">
                {t('compaction.policyWriteError', {
                  scope: visiblePolicySaveResult.scopeLabel,
                  directory: visiblePolicySaveResult.directory,
                  error: visiblePolicySaveResult.error,
                })}
              </p>
            )}
            {visiblePolicySaveResult?.status === 'refresh-error' && (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-[length:var(--fs-xs)]">
                <p className="min-w-0 break-words text-warning-100">
                  {t('compaction.policySavedRefreshError', {
                    scope: visiblePolicySaveResult.scopeLabel,
                    directory: visiblePolicySaveResult.directory,
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => void retryPolicyRefresh(visiblePolicySaveResult)}
                  className="min-h-11 shrink-0 text-accent-main-100 hover:underline"
                >
                  {t('compaction.retryStatusRefresh')}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-[length:var(--fs-sm)] text-text-400">
            {isStatusLoading ? t('compaction.loading') : t('compaction.noStatus')}
          </p>
        )}
      </SettingsSection>

      <SettingsSection title={t('compaction.eligibility')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-[length:var(--fs-sm)] text-text-400">{t('compaction.eligibilityDesc')}</p>
          <button
            type="button"
            onClick={() => void loadEligibility(currentScope)}
            aria-busy={isEligibilityLoading}
            className="min-h-11 shrink-0 px-2 text-[length:var(--fs-xs)] font-medium text-accent-main-100 hover:underline"
          >
            {t('compaction.refreshEligibility')}
          </button>
        </div>
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
              <label className="flex min-w-0 flex-col gap-2 text-[length:var(--fs-sm)] font-medium text-text-100">
                {t('compaction.provider')}
                <select
                  aria-label={t('compaction.provider')}
                  value={selectedProviderID}
                  disabled={isEligibilitySaving}
                  onChange={event => {
                    const next =
                      currentEligibility.find(item => item.providerID === event.target.value) ??
                      (focused?.providerID === event.target.value ? focused : null)
                    if (next) setSelection({ ...currentScope, providerID: next.providerID, modelID: next.modelID })
                  }}
                  className="min-h-11 min-w-0 rounded-lg border border-border-200 bg-bg-100 px-3 py-2 text-text-100 disabled:opacity-50"
                >
                  {providers.map(([providerID, name]) => (
                    <option key={providerID} value={providerID}>
                      {name} · {providerID}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-2 text-[length:var(--fs-sm)] font-medium text-text-100">
                {t('compaction.model')}
                <select
                  aria-label={t('compaction.model')}
                  value={selectedIdentity?.modelID ?? ''}
                  disabled={isEligibilitySaving}
                  onChange={event => {
                    const next = models.find(item => item.modelID === event.target.value)
                    if (next) setSelection({ ...currentScope, providerID: next.providerID, modelID: next.modelID })
                  }}
                  className="min-h-11 min-w-0 rounded-lg border border-border-200 bg-bg-100 px-3 py-2 text-text-100 disabled:opacity-50"
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
                  <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">
                    {t('compaction.eligibilitySource')}
                  </dt>
                  <dd className="min-w-0 break-words font-mono text-[length:var(--fs-sm)] text-text-100">
                    {provenanceDetail(selected.metadata?.modelRemoteCompaction)}
                  </dd>
                  <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">
                    {t('compaction.eligibilityProtocolSource')}
                  </dt>
                  <dd className="min-w-0 break-words font-mono text-[length:var(--fs-sm)] text-text-100">
                    {provenanceDetail(selected.metadata?.protocols)}
                  </dd>
                  <dt className="text-[length:var(--fs-sm)] font-medium text-text-300">
                    {t('compaction.eligibilityWriteTarget')}
                  </dt>
                  <dd className="min-w-0 break-words font-mono text-[length:var(--fs-sm)] text-text-100">
                    {writeTargetDetail(selected.metadata?.writeTarget)}
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
                      disabled={!selected.configurable || isEligibilitySaving}
                      onClick={() => void saveEligibility(selected.modelRemoteCompaction !== 'enabled')}
                      className="relative flex h-11 w-11 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span
                        aria-hidden="true"
                        className={`relative h-5 w-9 rounded-full transition-colors ${selected.modelRemoteCompaction === 'enabled' ? 'bg-accent-main-100' : 'bg-bg-300'}`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${selected.modelRemoteCompaction === 'enabled' ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                        />
                      </span>
                    </button>
                  </label>
                  <label className="flex min-w-44 flex-col gap-2 text-[length:var(--fs-sm)] font-medium text-text-100">
                    {t('compaction.eligibilityProtocols')}
                    <select
                      aria-label={t('compaction.eligibilityProtocols')}
                      value={protocolChoice}
                      disabled={!selected.configurable || isEligibilitySaving}
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
                  <button
                    type="button"
                    disabled={!selected.configurable || !eligibilityHasProjectOverride || isEligibilitySaving}
                    onClick={() => void saveEligibility(null)}
                    className="inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-[length:var(--fs-sm)] font-medium text-accent-main-100 hover:bg-bg-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('compaction.restoreEligibilityInheritance')}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[length:var(--fs-sm)] text-text-400">{t('compaction.eligibilityUnavailable')}</p>
            )}
            {isEligibilitySaving && (
              <p role="status" className="text-[length:var(--fs-xs)] text-text-400">
                {t('compaction.eligibilitySaving')}
              </p>
            )}
            {visibleEligibilitySaveResult?.status === 'success' && (
              <p role="status" className="break-words text-[length:var(--fs-xs)] text-success-100">
                {t('compaction.eligibilitySaved', {
                  providerID: visibleEligibilitySaveResult.providerID,
                  modelID: visibleEligibilitySaveResult.modelID,
                })}
              </p>
            )}
            {visibleEligibilitySaveResult?.status === 'write-error' && (
              <p role="alert" className="break-words text-[length:var(--fs-xs)] text-danger-100">
                {t('compaction.eligibilityWriteError', { error: visibleEligibilitySaveResult.error })}
              </p>
            )}
            {visibleEligibilitySaveResult?.status === 'refresh-error' && (
              <p role="alert" className="break-words text-[length:var(--fs-xs)] text-warning-100">
                {t('compaction.eligibilitySavedRefreshError')}
              </p>
            )}
          </>
        )}
        {currentEligibility.length > 0 && isEligibilityLoading && (
          <p role="status" className="text-[length:var(--fs-xs)] text-text-400">
            {t('compaction.eligibilityRefreshing')}
          </p>
        )}
        {currentEligibility.length > 0 && visibleEligibilityError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-[length:var(--fs-xs)]">
            <p className="min-w-0 break-words text-danger-100">
              {t('compaction.eligibilityLoadError', { error: visibleEligibilityError })}
            </p>
            <button
              type="button"
              onClick={() => void loadEligibility(currentScope)}
              className="min-h-11 shrink-0 text-accent-main-100 hover:underline"
            >
              {t('compaction.retry')}
            </button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title={t('compaction.resolvedStatus')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-[length:var(--fs-sm)] text-text-400">
            {t('compaction.resolvedStatusDesc', {
              identity: selectedIdentity
                ? `${selectedIdentity.providerID}/${selectedIdentity.modelID}`
                : t('compaction.none'),
            })}
          </p>
          <button
            type="button"
            disabled={!currentStatusIdentity}
            onClick={() => void refreshCurrentStatus()}
            aria-busy={isStatusLoading}
            className="min-h-11 shrink-0 px-2 text-[length:var(--fs-xs)] font-medium text-accent-main-100 hover:underline disabled:opacity-40"
          >
            {t('compaction.refreshStatus')}
          </button>
        </div>
        {isStatusLoading && (
          <p role="status" className="text-[length:var(--fs-sm)] text-text-400">
            {visibleStatus ? t('compaction.refreshingStatus') : t('compaction.loading')}
          </p>
        )}
        {visibleStatusError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-[length:var(--fs-sm)]">
            <p className="min-w-0 break-words text-danger-100">
              {t('compaction.loadError', { error: visibleStatusError })}
            </p>
            <button
              type="button"
              onClick={() => void refreshCurrentStatus()}
              className="min-h-11 shrink-0 text-accent-main-100 hover:underline"
            >
              {t('compaction.retry')}
            </button>
          </div>
        )}
        {visibleStatus ? (
          <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="min-w-0 text-[length:var(--fs-sm)] font-medium text-text-300">{label}</dt>
                <dd className="min-w-0 break-all font-mono text-[length:var(--fs-sm)] text-text-100">{value}</dd>
              </div>
            ))}
          </dl>
        ) : !isStatusLoading && !visibleStatusError ? (
          <p className="text-[length:var(--fs-sm)] text-text-400">{t('compaction.noStatus')}</p>
        ) : null}
      </SettingsSection>
    </div>
  )
}

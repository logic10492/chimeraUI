import type { FormatterStatus as SDKFormatterStatus, LspStatus as SDKLspStatus } from '@opencode-ai/sdk/v2/client'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getGraphFileSymbols,
  getGraphImpact,
  getGraphStatus,
  searchGraph,
  type GraphSearchResult,
  type GraphStatusResponse,
} from '../api/graph'
import { searchSymbols } from '../api/file'
import { getFormatterStatuses, getLspStatuses } from '../api/lsp'
import { apiScopeKey, type ApiScope } from '../api/scope'
import { layoutStore, useLayoutStore } from '../store/layoutStore'
import type { Symbol as WorkspaceSymbol } from '../types/api/file'
import { apiErrorHandler } from '../utils'
import { AlertCircleIcon, FolderIcon, RetryIcon, SearchIcon, ShareIcon, SpinnerIcon } from './Icons'

type GraphMode = 'search' | 'workspace' | 'file' | 'impact'

type GraphQueryResult =
  | { type: 'graph'; items: GraphSearchResult[] }
  | { type: 'workspace'; items: WorkspaceSymbol[] }
  | { type: 'impact'; value: unknown }

interface GraphPanelProps {
  apiScope: ApiScope
  isResizing?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) return
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key]) return value[key]
  }
}

function readLine(value: unknown): number | undefined {
  if (!isRecord(value)) return
  if (typeof value.startLine === 'number') return value.startLine
  if (typeof value.line === 'number') return value.line
  const range = isRecord(value.range) ? value.range : undefined
  const start = range && isRecord(range.start) ? range.start : undefined
  return typeof start?.line === 'number' ? start.line + 1 : undefined
}

function graphItem(result: GraphSearchResult) {
  const node = isRecord(result.node) ? result.node : {}
  const projection = isRecord(result.projection) ? result.projection : {}
  return {
    name: readString(node, ['name', 'qualifiedName', 'id']) ?? readString(projection, ['name', 'qualifiedName']) ?? '—',
    kind: readString(node, ['kind', 'type']) ?? readString(projection, ['kind', 'type']),
    path: readString(node, ['filePath', 'path', 'file']) ?? readString(projection, ['filePath', 'path', 'file']),
    line: readLine(node) ?? readLine(projection),
  }
}

function workspaceSymbolPath(uri: string): string | undefined {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'file:') return
    const path = decodeURIComponent(url.pathname)
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
  } catch {
    return
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const GraphPanel = memo(function GraphPanel({ apiScope, isResizing: _isResizing }: GraphPanelProps) {
  const { t } = useTranslation(['components', 'common'])
  const { panelTabs, activeTabId } = useLayoutStore()
  const stableScope = useMemo(
    () => ({ serverID: apiScope.serverID, directory: apiScope.directory, workspace: apiScope.workspace }),
    [apiScope.serverID, apiScope.directory, apiScope.workspace],
  )
  const scopeKey = apiScopeKey(stableScope)
  const currentFile = panelTabs.find(
    tab => tab.type === 'files' && !!tab.previewFile && activeTabId[tab.position] === tab.id,
  )?.previewFile

  const [status, setStatus] = useState<GraphStatusResponse | null>(null)
  const [lspStatuses, setLspStatuses] = useState<SDKLspStatus[]>([])
  const [formatterStatuses, setFormatterStatuses] = useState<SDKFormatterStatus[]>([])
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [mode, setMode] = useState<GraphMode>('search')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [filePath, setFilePath] = useState('')
  const [startLine, setStartLine] = useState('')
  const [endLine, setEndLine] = useState('')
  const [impactNodeID, setImpactNodeID] = useState('')
  const [impactPath, setImpactPath] = useState('')
  const [impactDepth, setImpactDepth] = useState('2')
  const [result, setResult] = useState<GraphQueryResult | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const statusRequestRef = useRef(0)
  const queryRequestRef = useRef(0)

  const loadStatus = useCallback(async () => {
    const request = ++statusRequestRef.current
    setStatusLoading(true)
    setStatusError(null)
    setServiceError(null)

    const [graph, lsp, formatter] = await Promise.allSettled([
      getGraphStatus(stableScope),
      getLspStatuses(stableScope),
      getFormatterStatuses(stableScope),
    ])
    if (request !== statusRequestRef.current) return

    if (graph.status === 'fulfilled') {
      setStatus(graph.value)
    } else {
      apiErrorHandler('load graph status', graph.reason)
      setStatus(null)
      setStatusError(t('graphPanel.failedStatus'))
    }

    setLspStatuses(lsp.status === 'fulfilled' ? lsp.value : [])
    setFormatterStatuses(formatter.status === 'fulfilled' ? formatter.value : [])
    if (lsp.status === 'rejected' || formatter.status === 'rejected') {
      setServiceError(t('graphPanel.failedServices'))
    }
    setStatusLoading(false)
  }, [stableScope, t])

  useEffect(() => {
    queryRequestRef.current += 1
    setResult(null)
    setQueryError(null)
    setQueryLoading(false)
    void loadStatus()
    return () => {
      statusRequestRef.current += 1
      queryRequestRef.current += 1
    }
  }, [loadStatus, scopeKey])

  const selectMode = useCallback((nextMode: GraphMode) => {
    queryRequestRef.current += 1
    setMode(nextMode)
    setResult(null)
    setQueryError(null)
    setQueryLoading(false)
  }, [])

  const runQuery = useCallback(async () => {
    if (mode !== 'workspace' && !status?.initialized) return
    if ((mode === 'search' || mode === 'workspace') && !query.trim()) {
      setQueryError(t('graphPanel.queryRequired'))
      return
    }
    if (mode === 'file' && !filePath.trim()) {
      setQueryError(t('graphPanel.pathRequired'))
      return
    }
    if (mode === 'impact' && !impactNodeID.trim() && !impactPath.trim()) {
      setQueryError(t('graphPanel.impactRequired'))
      return
    }

    const request = ++queryRequestRef.current
    setQueryLoading(true)
    setQueryError(null)

    try {
      if (mode === 'search') {
        const response = await searchGraph(
          { query: query.trim(), kind: kind.trim() || undefined, limit: 20 },
          stableScope,
        )
        if (request === queryRequestRef.current) setResult({ type: 'graph', items: response.results })
        return
      }
      if (mode === 'workspace') {
        const response = await searchSymbols(query.trim(), stableScope)
        if (request === queryRequestRef.current) setResult({ type: 'workspace', items: response })
        return
      }
      if (mode === 'file') {
        const response = await getGraphFileSymbols(
          {
            path: filePath.trim(),
            kind: kind.trim() || undefined,
            startLine: startLine ? Number(startLine) : undefined,
            endLine: endLine ? Number(endLine) : undefined,
            limit: 50,
          },
          stableScope,
        )
        if (request === queryRequestRef.current) setResult({ type: 'graph', items: response.results })
        return
      }
      const response = await getGraphImpact(
        {
          nodeID: impactNodeID.trim() || undefined,
          path: impactPath.trim() || undefined,
          depth: Math.min(5, Math.max(1, Number(impactDepth) || 2)),
        },
        stableScope,
      )
      if (request === queryRequestRef.current) setResult({ type: 'impact', value: response.results })
    } catch (error) {
      if (request !== queryRequestRef.current) return
      apiErrorHandler('query graph', error)
      setResult(null)
      setQueryError(t('graphPanel.failedQuery'))
    } finally {
      if (request === queryRequestRef.current) setQueryLoading(false)
    }
  }, [endLine, filePath, impactDepth, impactNodeID, impactPath, kind, mode, query, stableScope, startLine, status, t])

  const openFile = useCallback((path: string) => {
    layoutStore.openFilePreview({ path, name: fileName(path) })
  }, [])

  const useCurrentFile = useCallback(() => {
    if (!currentFile) return
    if (mode === 'impact') setImpactPath(currentFile.path)
    else setFilePath(currentFile.path)
  }, [currentFile, mode])

  const connectedLsp = lspStatuses.filter(item => item.status === 'connected').length
  const enabledFormatters = formatterStatuses.filter(item => item.enabled).length
  const graphUnavailable = !!status && !status.initialized
  const emptyResult =
    result?.type === 'graph'
      ? result.items.length === 0
      : result?.type === 'workspace'
        ? result.items.length === 0
        : false

  return (
    <div className="flex h-full flex-col bg-bg-100">
      <div className="relative flex h-10 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2 text-[length:var(--fs-xs)] font-medium text-text-100">
          <ShareIcon size={13} />
          <span>{t('graphPanel.title')}</span>
          {status && (
            <span
              className={`rounded px-1.5 py-0.5 text-[length:var(--fs-xxs)] ${status.initialized ? 'bg-success-100/15 text-success-100' : 'bg-warning-100/15 text-warning-100'}`}
            >
              {status.initialized ? t('graphPanel.ready') : t('graphPanel.unavailable')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={statusLoading}
          aria-label={t('common:refresh')}
          title={t('common:refresh')}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-300 transition-colors hover:bg-bg-200/50 hover:text-text-100 disabled:opacity-50"
        >
          <RetryIcon size={12} className={statusLoading ? 'animate-spin' : ''} />
        </button>
        <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-border-200/30" />
      </div>

      <div
        aria-live="polite"
        className="border-b border-border-200/30 px-3 py-2 text-[length:var(--fs-xs)] text-text-300"
      >
        {statusLoading && !status ? (
          <div className="flex items-center gap-2 py-1">
            <SpinnerIcon size={13} className="animate-spin opacity-60" />
            <span>{t('graphPanel.loadingStatus')}</span>
          </div>
        ) : statusError ? (
          <div role="alert" className="flex items-center gap-2 text-danger-100">
            <AlertCircleIcon size={13} />
            <span>{statusError}</span>
          </div>
        ) : status ? (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span>
                {t('graphPanel.dataRootStatus')}: <strong className="text-text-100">{status.dataRootStatus}</strong>
              </span>
              {status.backend && (
                <span>
                  {t('graphPanel.backend')}: <strong className="text-text-100">{status.backend}</strong>
                </span>
              )}
              {status.journalMode && (
                <span>
                  {t('graphPanel.journalMode')}: <strong className="text-text-100">{status.journalMode}</strong>
                </span>
              )}
            </div>
            <div className="truncate font-mono text-text-400" title={status.dataRoot}>
              {status.dataRoot}
            </div>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded bg-bg-200/60 px-1.5 py-0.5">
            {t('graphPanel.lspCount', { connected: connectedLsp, total: lspStatuses.length })}
          </span>
          <span className="rounded bg-bg-200/60 px-1.5 py-0.5">
            {t('graphPanel.formatterCount', { enabled: enabledFormatters, total: formatterStatuses.length })}
          </span>
          {serviceError && <span className="text-warning-100">{serviceError}</span>}
        </div>
      </div>

      {graphUnavailable && (
        <div
          role="status"
          className="mx-3 mt-3 rounded-md border border-warning-100/30 bg-warning-100/10 px-3 py-2 text-[length:var(--fs-sm)] text-text-200"
        >
          <div className="font-medium text-warning-100">{t('graphPanel.uninitializedTitle')}</div>
          <div className="mt-1">{t('graphPanel.uninitializedBody', { status: status.dataRootStatus })}</div>
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-border-200/30 px-3 py-2">
        {(['search', 'workspace', 'file', 'impact'] as const).map(item => (
          <button
            key={item}
            type="button"
            aria-pressed={mode === item}
            onClick={() => selectMode(item)}
            className={`whitespace-nowrap rounded-md px-2 py-1 text-[length:var(--fs-xs)] transition-colors ${mode === item ? 'bg-bg-200 text-text-100' : 'text-text-400 hover:bg-bg-200/50 hover:text-text-100'}`}
          >
            {t(`graphPanel.mode.${item}`)}
          </button>
        ))}
      </div>

      <form
        className="space-y-2 border-b border-border-200/30 px-3 py-3"
        onSubmit={event => {
          event.preventDefault()
          void runQuery()
        }}
      >
        {(mode === 'search' || mode === 'workspace') && (
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-400" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                aria-label={t('graphPanel.query')}
                placeholder={
                  mode === 'workspace' ? t('graphPanel.workspacePlaceholder') : t('graphPanel.searchPlaceholder')
                }
                className="w-full rounded-md border border-transparent bg-bg-200/40 py-1.5 pl-8 pr-2 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400 focus:border-border-200 focus:bg-bg-000"
              />
            </div>
            {mode === 'search' && (
              <input
                value={kind}
                onChange={event => setKind(event.target.value)}
                aria-label={t('graphPanel.kind')}
                placeholder={t('graphPanel.kindPlaceholder')}
                className="w-24 rounded-md border border-transparent bg-bg-200/40 px-2 py-1.5 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400 focus:border-border-200 focus:bg-bg-000"
              />
            )}
          </div>
        )}

        {mode === 'file' && (
          <>
            <div className="flex gap-2">
              <input
                value={filePath}
                onChange={event => setFilePath(event.target.value)}
                aria-label={t('graphPanel.filePath')}
                placeholder={t('graphPanel.filePlaceholder')}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-bg-200/40 px-2 py-1.5 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400 focus:border-border-200 focus:bg-bg-000"
              />
              {currentFile && (
                <button
                  type="button"
                  onClick={useCurrentFile}
                  className="rounded-md bg-bg-200/60 px-2 text-[length:var(--fs-xs)] text-text-200 hover:bg-bg-200"
                >
                  {t('graphPanel.useOpenFile')}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={kind}
                onChange={event => setKind(event.target.value)}
                aria-label={t('graphPanel.kind')}
                placeholder={t('graphPanel.kindPlaceholder')}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-bg-200/40 px-2 py-1.5 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400 focus:border-border-200 focus:bg-bg-000"
              />
              <input
                type="number"
                min={1}
                value={startLine}
                onChange={event => setStartLine(event.target.value)}
                aria-label={t('graphPanel.startLine')}
                placeholder={t('graphPanel.startLine')}
                className="w-20 rounded-md border border-transparent bg-bg-200/40 px-2 py-1.5 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400 focus:border-border-200 focus:bg-bg-000"
              />
              <input
                type="number"
                min={1}
                value={endLine}
                onChange={event => setEndLine(event.target.value)}
                aria-label={t('graphPanel.endLine')}
                placeholder={t('graphPanel.endLine')}
                className="w-20 rounded-md border border-transparent bg-bg-200/40 px-2 py-1.5 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400 focus:border-border-200 focus:bg-bg-000"
              />
            </div>
          </>
        )}

        {mode === 'impact' && (
          <>
            <div className="flex gap-2">
              <input
                value={impactNodeID}
                onChange={event => setImpactNodeID(event.target.value)}
                aria-label={t('graphPanel.nodeID')}
                placeholder={t('graphPanel.nodePlaceholder')}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-bg-200/40 px-2 py-1.5 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400 focus:border-border-200 focus:bg-bg-000"
              />
              <input
                type="number"
                min={1}
                max={5}
                value={impactDepth}
                onChange={event => setImpactDepth(event.target.value)}
                aria-label={t('graphPanel.depth')}
                className="w-16 rounded-md border border-transparent bg-bg-200/40 px-2 py-1.5 text-[length:var(--fs-sm)] text-text-100 focus:border-border-200 focus:bg-bg-000"
              />
            </div>
            <div className="flex gap-2">
              <input
                value={impactPath}
                onChange={event => setImpactPath(event.target.value)}
                aria-label={t('graphPanel.filePath')}
                placeholder={t('graphPanel.impactPathPlaceholder')}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-bg-200/40 px-2 py-1.5 text-[length:var(--fs-sm)] text-text-100 placeholder:text-text-400 focus:border-border-200 focus:bg-bg-000"
              />
              {currentFile && (
                <button
                  type="button"
                  onClick={useCurrentFile}
                  className="rounded-md bg-bg-200/60 px-2 text-[length:var(--fs-xs)] text-text-200 hover:bg-bg-200"
                >
                  {t('graphPanel.useOpenFile')}
                </button>
              )}
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-2">
          <div role={queryError ? 'alert' : undefined} className="min-h-4 text-[length:var(--fs-xs)] text-danger-100">
            {queryError}
          </div>
          <button
            type="submit"
            disabled={queryLoading || (mode !== 'workspace' && !status?.initialized)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-main-100 px-3 py-1.5 text-[length:var(--fs-sm)] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {queryLoading && <SpinnerIcon size={12} className="animate-spin" />}
            {t('graphPanel.run')}
          </button>
        </div>
      </form>

      <div aria-busy={queryLoading} aria-live="polite" className="min-h-0 flex-1 overflow-auto p-2">
        {!result && !queryLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[length:var(--fs-sm)] text-text-400">
            <ShareIcon size={24} className="opacity-30" />
            <span>{t('graphPanel.noQuery')}</span>
          </div>
        ) : emptyResult ? (
          <div className="flex h-full items-center justify-center text-[length:var(--fs-sm)] text-text-400">
            {t('graphPanel.noResults')}
          </div>
        ) : result?.type === 'impact' ? (
          <pre className="whitespace-pre-wrap break-words rounded-md bg-bg-200/40 p-3 font-mono text-[length:var(--fs-xs)] text-text-200">
            {json(result.value)}
          </pre>
        ) : result?.type === 'workspace' ? (
          <div className="space-y-1">
            {result.items.map((item, index) => {
              const path = workspaceSymbolPath(item.location.uri)
              const line = item.location.range.start.line + 1
              return (
                <div
                  key={`${item.location.uri}:${line}:${item.name}:${index}`}
                  className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-bg-200/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[length:var(--fs-sm)] font-medium text-text-100">{item.name}</div>
                    <div className="truncate font-mono text-[length:var(--fs-xs)] text-text-400">
                      {path ?? item.location.uri}:{line}
                    </div>
                  </div>
                  {path && (
                    <button
                      type="button"
                      onClick={() => openFile(path)}
                      aria-label={t('graphPanel.openFile', { path })}
                      className="rounded p-1.5 text-text-400 hover:bg-bg-200 hover:text-text-100"
                    >
                      <FolderIcon size={13} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : result?.type === 'graph' ? (
          <div className="space-y-1">
            {result.items.map((item, index) => {
              const display = graphItem(item)
              return (
                <div
                  key={`${display.path ?? 'node'}:${display.name}:${index}`}
                  className="rounded-md px-2 py-2 hover:bg-bg-200/50"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[length:var(--fs-sm)] font-medium text-text-100">
                        {display.name}
                      </div>
                      <div className="truncate font-mono text-[length:var(--fs-xs)] text-text-400">
                        {[display.kind, display.path, display.line ? `:${display.line}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    {display.path && (
                      <button
                        type="button"
                        onClick={() => openFile(display.path!)}
                        aria-label={t('graphPanel.openFile', { path: display.path })}
                        className="rounded p-1.5 text-text-400 hover:bg-bg-200 hover:text-text-100"
                      >
                        <FolderIcon size={13} />
                      </button>
                    )}
                  </div>
                  <details className="mt-1 text-[length:var(--fs-xs)] text-text-400">
                    <summary className="cursor-pointer">{t('graphPanel.details')}</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-bg-200/40 p-2 font-mono text-text-200">
                      {json(item)}
                    </pre>
                  </details>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
})

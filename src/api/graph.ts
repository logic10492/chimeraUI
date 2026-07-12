import { apiScopeQuery, resolveApiScope, type ApiScopeInput } from './scope'
import { getSDKClient, unwrap } from './sdk'

export interface GraphStatusResponse {
  initialized: boolean
  projectRoot: string
  dataRoot: string
  dataRootStatus: string
  jobStatus: unknown
  snapshot?: unknown
  stats?: unknown
  backend?: string
  journalMode?: string
}

export interface GraphSearchResult {
  score?: number | string
  node: unknown
  projection?: unknown
}

export interface GraphSearchResponse extends Omit<GraphStatusResponse, 'stats' | 'backend' | 'journalMode'> {
  results: GraphSearchResult[]
}

export interface GraphFileSymbolsResponse extends Omit<GraphStatusResponse, 'stats' | 'backend' | 'journalMode'> {
  path: string
  results: GraphSearchResult[]
}

export interface GraphImpactResponse extends Omit<GraphStatusResponse, 'stats' | 'backend' | 'journalMode'> {
  results: unknown
}

export interface GraphSearchParams {
  query: string
  kind?: string
  limit?: number
}

export interface GraphFileSymbolsParams {
  path: string
  kind?: string
  startLine?: number
  endLine?: number
  limit?: number
}

export interface GraphImpactParams {
  nodeID?: string
  path?: string
  depth?: number
}

export async function getGraphStatus(input?: ApiScopeInput): Promise<GraphStatusResponse> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).graph.status(apiScopeQuery(scope)))
}

export async function searchGraph(params: GraphSearchParams, input?: ApiScopeInput): Promise<GraphSearchResponse> {
  const scope = resolveApiScope(input)
  return unwrap(await getSDKClient(scope).graph.search({ ...apiScopeQuery(scope), ...params }))
}

export async function getGraphFileSymbols(
  params: GraphFileSymbolsParams,
  input?: ApiScopeInput,
): Promise<GraphFileSymbolsResponse> {
  const scope = resolveApiScope(input)
  return unwrap(
    await getSDKClient(scope).graph.file.symbols({
      ...apiScopeQuery(scope),
      ...params,
      startLine: params.startLine === undefined ? undefined : String(params.startLine),
      endLine: params.endLine === undefined ? undefined : String(params.endLine),
    }),
  )
}

export async function getGraphImpact(
  params: GraphImpactParams = {},
  input?: ApiScopeInput,
): Promise<GraphImpactResponse> {
  const scope = resolveApiScope(input)
  return unwrap(
    await getSDKClient(scope).graph.impact({
      ...apiScopeQuery(scope),
      ...params,
      depth: params.depth === undefined ? undefined : String(params.depth),
    }),
  )
}

import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateApiCallInventory, loadCurrentOpenApiOperations } from './api-call-inventory'

type JsonObject = Record<string, unknown>
type Classification = 'reuse' | 'fix' | 'add' | 'client-local'
type ServerStatus = 'existing' | 'closed' | 'planned' | 'not-applicable'
type UiStatus = 'implemented' | 'deferred'
type Transport = 'sdk' | 'sse' | 'websocket'

type OperationClaim = {
  operationId: string
  method: string
  path: string
  transport: Transport
  currentlyUsed: boolean
}

type Workflow = {
  id: string
  classification: Classification
  phase: number
  status: { server: ServerStatus; ui: UiStatus }
  operations: OperationClaim[]
  plannedContract?: { seedOperationId: string; transport: Transport; change: string }
  closure: { files: string[]; tests: string[] }
}

export type ServerWorkflowClosure = {
  schemaVersion: 2
  authority: {
    source: string
    openapi: { package: string; command: string }
    currentlyUsedInventory: string
    excludedAuthorities: string[]
  }
  phase0: {
    serverFixes: string[]
    serverAdds: string[]
    statement: string
  }
  workflows: Workflow[]
}

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const serverWorkflowClosurePath = path.join(packageDir, 'server-workflow-closure.json')
const classifications = new Set<Classification>(['reuse', 'fix', 'add', 'client-local'])
const serverStatuses = new Set<ServerStatus>(['existing', 'closed', 'planned', 'not-applicable'])
const uiStatuses = new Set<UiStatus>(['implemented', 'deferred'])
const transports = new Set<Transport>(['sdk', 'sse', 'websocket'])
const requiredWorkflowIds = new Set([
  'bootstrap-discovery',
  'session-chat-core',
  'interaction-history',
  'global-sse-events',
  'sse-overflow-gap-resync-signal',
  'pty-crud',
  'pty-connect-query-openapi-parity',
  'candidate-server-health-probing',
  'provider-auth-oauth-disconnect',
  'mcp-connectivity',
  'file-context-search',
  'workspace-symbol-search',
  'graph-workflows',
  'worktree-workflows',
  'workspace-lifecycle',
  'vcs-file-lsp-formatter',
  'panes-and-layout',
  'browser-bridge',
  'tauri-bridges',
  'pty-connect-ticket-migration',
])

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as JsonObject
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array`)
  }
  return value
}

function parseStatus(value: unknown, workflowId: unknown): Workflow['status'] {
  const status = asObject(value, `${workflowId}.status`)
  const server = asString(status.server, `${workflowId}.status.server`)
  const ui = asString(status.ui, `${workflowId}.status.ui`)
  if (!serverStatuses.has(server as ServerStatus)) throw new Error(`${workflowId} has invalid server status ${server}`)
  if (!uiStatuses.has(ui as UiStatus)) throw new Error(`${workflowId} has invalid UI status ${ui}`)
  return { server: server as ServerStatus, ui: ui as UiStatus }
}

function parseWorkflow(value: unknown, index: number): Workflow {
  const workflow = asObject(value, `workflows[${index}]`)
  const classification = asString(workflow.classification, `workflows[${index}].classification`)
  if (!classifications.has(classification as Classification))
    throw new Error(`Invalid classification ${classification}`)
  if (!Number.isInteger(workflow.phase) || (workflow.phase as number) < 0) {
    throw new Error(`${workflow.id}.phase must be a non-negative integer`)
  }
  if (!Array.isArray(workflow.operations)) throw new Error(`${workflow.id}.operations must be an array`)
  const operations = workflow.operations.map((value, operationIndex) => {
    const operation = asObject(value, `${workflow.id}.operations[${operationIndex}]`)
    const transport = asString(operation.transport, `${workflow.id}.operations[${operationIndex}].transport`)
    if (!transports.has(transport as Transport)) throw new Error(`Invalid transport ${transport}`)
    if (typeof operation.currentlyUsed !== 'boolean')
      throw new Error(`${operation.operationId}.currentlyUsed must be boolean`)
    return {
      operationId: asString(operation.operationId, `${workflow.id}.operationId`),
      method: asString(operation.method, `${workflow.id}.method`).toUpperCase(),
      path: asString(operation.path, `${workflow.id}.path`),
      transport: transport as Transport,
      currentlyUsed: operation.currentlyUsed,
    }
  })
  const closure = asObject(workflow.closure, `${workflow.id}.closure`)
  const plannedContract = workflow.plannedContract
    ? asObject(workflow.plannedContract, `${workflow.id}.plannedContract`)
    : undefined
  const plannedTransport = plannedContract
    ? asString(plannedContract.transport, `${workflow.id}.plannedContract.transport`)
    : undefined
  if (plannedTransport && !transports.has(plannedTransport as Transport)) {
    throw new Error(`${workflow.id} has invalid planned contract transport ${plannedTransport}`)
  }
  return {
    id: asString(workflow.id, `workflows[${index}].id`),
    classification: classification as Classification,
    phase: workflow.phase as number,
    status: parseStatus(workflow.status, workflow.id),
    operations,
    plannedContract: plannedContract
      ? {
          seedOperationId: asString(plannedContract.seedOperationId, `${workflow.id}.plannedContract.seedOperationId`),
          transport: plannedTransport as Transport,
          change: asString(plannedContract.change, `${workflow.id}.plannedContract.change`),
        }
      : undefined,
    closure: {
      files: asStringArray(closure.files, `${workflow.id}.closure.files`),
      tests: asStringArray(closure.tests, `${workflow.id}.closure.tests`),
    },
  }
}

export async function loadServerWorkflowClosure(): Promise<ServerWorkflowClosure> {
  const document: unknown = JSON.parse(await readFile(serverWorkflowClosurePath, 'utf8'))
  const root = asObject(document, 'server workflow closure')
  const authority = asObject(root.authority, 'authority')
  const openapi = asObject(authority.openapi, 'authority.openapi')
  const phase0 = asObject(root.phase0, 'phase0')
  if (root.schemaVersion !== 2) throw new Error('Unsupported server workflow closure schemaVersion')
  if (!Array.isArray(root.workflows)) throw new Error('workflows must be an array')
  return {
    schemaVersion: 2,
    authority: {
      source: asString(authority.source, 'authority.source'),
      openapi: {
        package: asString(openapi.package, 'authority.openapi.package'),
        command: asString(openapi.command, 'authority.openapi.command'),
      },
      currentlyUsedInventory: asString(authority.currentlyUsedInventory, 'authority.currentlyUsedInventory'),
      excludedAuthorities: asStringArray(authority.excludedAuthorities, 'authority.excludedAuthorities'),
    },
    phase0: {
      serverFixes: asStringArray(phase0.serverFixes, 'phase0.serverFixes'),
      serverAdds: asStringArray(phase0.serverAdds, 'phase0.serverAdds'),
      statement: asString(phase0.statement, 'phase0.statement'),
    },
    workflows: root.workflows.map(parseWorkflow),
  }
}

function validateWorkflowStatus(workflow: Workflow): void {
  if (workflow.classification === 'reuse' && workflow.status.server !== 'existing') {
    throw new Error(`${workflow.id} reuse classification requires existing server status`)
  }
  if (workflow.classification === 'fix' && !['closed', 'planned'].includes(workflow.status.server)) {
    throw new Error(`${workflow.id} fix classification requires closed or planned server status`)
  }
  if (workflow.classification === 'add' && !['closed', 'planned'].includes(workflow.status.server)) {
    throw new Error(`${workflow.id} add classification requires closed or planned server status`)
  }
  if (workflow.classification === 'client-local' && workflow.status.server !== 'not-applicable') {
    throw new Error(`${workflow.id} client-local classification requires not-applicable server status`)
  }
  if (workflow.classification === 'client-local' && workflow.operations.length > 0) {
    throw new Error(`${workflow.id} client-local workflow cannot reference server operations`)
  }
  if (workflow.classification === 'add' && workflow.status.server === 'planned') {
    if (workflow.operations.length > 0)
      throw new Error(`${workflow.id} planned add cannot claim operations before they exist`)
    if (!workflow.plannedContract) throw new Error(`${workflow.id} planned add must describe its planned contract`)
  }
  if (
    workflow.classification !== 'client-local' &&
    !(workflow.classification === 'add' && workflow.status.server === 'planned')
  ) {
    if (workflow.operations.length === 0) throw new Error(`${workflow.id} must reference current server operations`)
  }
  if (
    workflow.status.server === 'closed' &&
    (workflow.closure.files.length === 0 || workflow.closure.tests.length === 0)
  ) {
    throw new Error(`${workflow.id} closed server change must record closure files and tests`)
  }
  if (workflow.phase === 0 && ['fix', 'add'].includes(workflow.classification) && workflow.status.server !== 'closed') {
    throw new Error(`${workflow.id} Phase 0 server change must be closed`)
  }
}

export async function validateServerWorkflowClosure(): Promise<{ workflows: number; operations: number }> {
  const [artifact, openapi, inventory] = await Promise.all([
    loadServerWorkflowClosure(),
    loadCurrentOpenApiOperations(),
    generateApiCallInventory(),
  ])
  if (artifact.authority.source !== 'current-chimera-server-openapi-sdk') {
    throw new Error('Artifact authority must be the current Chimera server/OpenAPI/SDK')
  }
  if (
    artifact.authority.openapi.package !== 'packages/chimera' ||
    artifact.authority.openapi.command !== 'bun dev generate'
  ) {
    throw new Error('Artifact OpenAPI authority must use packages/chimera and bun dev generate')
  }
  if (artifact.authority.currentlyUsedInventory !== 'api-call-inventory.json') {
    throw new Error('Artifact must use api-call-inventory.json for currentlyUsed claims')
  }
  if (
    !artifact.authority.excludedAuthorities.includes('tui-inventory') ||
    !artifact.authority.excludedAuthorities.includes('second-server-contract')
  ) {
    throw new Error('Artifact must exclude TUI inventory and any second server contract as authorities')
  }

  const ids = artifact.workflows.map(workflow => workflow.id)
  if (new Set(ids).size !== ids.length) throw new Error('Workflow ids must be unique')
  const missing = [...requiredWorkflowIds].filter(id => !ids.includes(id))
  if (missing.length > 0) throw new Error(`Missing required workflows: ${missing.join(', ')}`)
  artifact.workflows.forEach(validateWorkflowStatus)

  const phase0Fixes = artifact.workflows.filter(workflow => workflow.phase === 0 && workflow.classification === 'fix')
  const phase0Adds = artifact.workflows.filter(workflow => workflow.phase === 0 && workflow.classification === 'add')
  if (
    phase0Fixes.length !== 1 ||
    phase0Fixes[0].id !== 'pty-connect-query-openapi-parity' ||
    phase0Fixes[0].status.server !== 'closed'
  ) {
    throw new Error('PTY connect query/OpenAPI parity must be the only closed Phase 0 server fix')
  }
  if (phase0Adds.length !== 0) throw new Error('Phase 0 must contain zero server adds')
  if (artifact.phase0.serverFixes.join(',') !== 'pty-connect-query-openapi-parity') {
    throw new Error('phase0.serverFixes must name only the PTY parity fix')
  }
  if (artifact.phase0.serverAdds.length !== 0) throw new Error('phase0.serverAdds must be empty')

  const deferredReusePhases = new Map([
    ['provider-auth-oauth-disconnect', 2],
    ['graph-workflows', 5],
    ['workspace-lifecycle', 2],
    ['pty-connect-ticket-migration', 2],
  ])
  deferredReusePhases.forEach((phase, id) => {
    const workflow = artifact.workflows.find(item => item.id === id)
    if (workflow?.phase !== phase || workflow.status.server !== 'existing' || workflow.status.ui !== 'deferred') {
      throw new Error(`${id} must be existing server reuse with deferred Phase ${phase} UI work`)
    }
  })
  const workspaceSymbols = artifact.workflows.find(workflow => workflow.id === 'workspace-symbol-search')
  if (
    workspaceSymbols?.phase !== 5 ||
    workspaceSymbols.classification !== 'fix' ||
    workspaceSymbols.status.server !== 'planned'
  ) {
    throw new Error('workspace-symbol-search must be a planned Phase 5 server fix')
  }
  const overflowSignal = artifact.workflows.find(workflow => workflow.id === 'sse-overflow-gap-resync-signal')
  if (
    overflowSignal?.phase !== 3 ||
    overflowSignal.classification !== 'add' ||
    overflowSignal.status.server !== 'planned'
  ) {
    throw new Error('sse-overflow-gap-resync-signal must be a planned Phase 3 server add')
  }

  const inventoryById = new Map(inventory.calls.map(call => [call.operationId, call]))
  const claims = artifact.workflows.flatMap(workflow => workflow.operations.map(operation => ({ workflow, operation })))
  for (const claim of claims) {
    const current = openapi.get(claim.operation.operationId)
    if (!current) throw new Error(`${claim.operation.operationId} is missing from current Chimera OpenAPI`)
    if (current.method !== claim.operation.method || current.path !== claim.operation.path) {
      throw new Error(
        `${claim.operation.operationId} is stale: artifact has ${claim.operation.method} ${claim.operation.path}, OpenAPI has ${current.method} ${current.path}`,
      )
    }
    const used = inventoryById.get(claim.operation.operationId)
    if (claim.operation.currentlyUsed !== !!used) {
      throw new Error(`${claim.operation.operationId}.currentlyUsed does not match api-call-inventory.json`)
    }
    if (
      used &&
      (used.method !== claim.operation.method ||
        used.path !== claim.operation.path ||
        used.transport !== claim.operation.transport)
    ) {
      throw new Error(`${claim.operation.operationId} does not match its api-call-inventory.json method/path/transport`)
    }
  }

  await Promise.all(
    artifact.workflows.flatMap(workflow =>
      [...workflow.closure.files, ...workflow.closure.tests].map(async file => {
        await access(path.resolve(packageDir, file)).catch(() => {
          throw new Error(`${workflow.id} closure path does not exist: ${file}`)
        })
      }),
    ),
  )

  return { workflows: artifact.workflows.length, operations: claims.length }
}

async function main(): Promise<void> {
  const result = await validateServerWorkflowClosure()
  console.log(
    `Server workflow closure is current (${result.workflows} workflows, ${result.operations} operation claims)`,
  )
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

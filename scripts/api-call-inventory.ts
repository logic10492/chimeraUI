import { execFile as execFileCallback } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { format, resolveConfig } from 'prettier'
import ts from 'typescript'

type JsonObject = Record<string, unknown>
type Transport = 'sdk' | 'sse' | 'websocket'

type SourceRef = {
  file: string
  line: number
}

type Usage = {
  transport: Transport
  sources: SourceRef[]
  rawQuery: Set<string>
  middlewareQuery: Set<string>
}

type IndexedOperation = {
  method: string
  path: string
  pathItem: JsonObject
  operation: JsonObject
}

type BodyContract = {
  contentTypes: string[]
  fields: string[]
  required: string[]
}

export type ApiCallInventory = {
  schemaVersion: 1
  openapi: {
    package: 'packages/chimera'
    command: 'bun dev generate'
  }
  calls: Array<{
    operationId: string
    clientMethod: string | null
    transport: Transport
    method: string
    path: string
    pathParameters: string[]
    query: {
      openapi: string[]
      raw: string[]
      middleware: string[]
    }
    body: BodyContract | null
    scope: {
      kind: 'global' | 'instance'
      query: string[]
    }
    sources: SourceRef[]
  }>
}

type SpecialTransport = {
  operationId: string
  transport: Exclude<Transport, 'sdk'>
  file: string
  queryBuilder?: string
  middlewareQuery: readonly string[]
  matches: (value: string) => boolean
}

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = path.join(packageDir, 'src/api')
const chimeraPackageDir = path.resolve(packageDir, '../chimera')
export const apiCallInventoryPath = path.join(packageDir, 'api-call-inventory.json')
const execFile = promisify(execFileCallback)
const httpMethods = ['get', 'post', 'put', 'delete', 'patch'] as const
const scopeQuery = new Set(['directory', 'workspace'])
const specialTransports: readonly SpecialTransport[] = [
  {
    operationId: 'global.event',
    transport: 'sse',
    file: 'src/api/events.ts',
    middlewareQuery: [],
    matches: value => value.includes('/global/event'),
  },
  {
    operationId: 'pty.connect',
    transport: 'websocket',
    file: 'src/api/pty.ts',
    queryBuilder: 'buildQueryString',
    middlewareQuery: ['auth_token'],
    matches: value => value.includes('/pty/${}/connect'),
  },
]

function asObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  return value as JsonObject
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/')
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function sortedSources(sources: SourceRef[]): SourceRef[] {
  return [...new Map(sources.map(source => [`${source.file}:${source.line}`, source])).values()].sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
  )
}

function sourceRef(sourceFile: ts.SourceFile, node: ts.Node): SourceRef {
  return {
    file: normalizePath(path.relative(packageDir, sourceFile.fileName)),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  }
}

function isGetSdkClientCall(value: ts.Expression | undefined): boolean {
  return (
    !!value &&
    ts.isCallExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === 'getSDKClient'
  )
}

function isCreateSdkClientCall(value: ts.Expression | undefined): boolean {
  return (
    !!value &&
    ts.isCallExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === 'createOpencodeClient'
  )
}

function operationIdFromCall(node: ts.CallExpression, clients: Set<string>): string | undefined {
  const names: string[] = []
  let current: ts.Expression = node.expression
  while (ts.isPropertyAccessExpression(current)) {
    names.unshift(current.name.text)
    current = current.expression
  }
  if (names.length < 2) return
  if (ts.isIdentifier(current) && clients.has(current.text)) return names.join('.')
  if (isGetSdkClientCall(current)) return names.join('.')
}

function addUsage(usages: Map<string, Usage>, operationId: string, transport: Transport, source: SourceRef): Usage {
  const current = usages.get(operationId)
  if (current && current.transport !== transport) {
    throw new Error(`${operationId} is used through both ${current.transport} and ${transport}`)
  }
  if (current) {
    current.sources.push(source)
    return current
  }
  const created = {
    transport,
    sources: [source],
    rawQuery: new Set<string>(),
    middlewareQuery: new Set<string>(),
  }
  usages.set(operationId, created)
  return created
}

function scanSdkCalls(sourceFile: ts.SourceFile, usages: Map<string, Usage>): void {
  const clients = new Set<string>()
  const findClients = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      (isGetSdkClientCall(node.initializer) || isCreateSdkClientCall(node.initializer))
    ) {
      clients.add(node.name.text)
    }
    ts.forEachChild(node, findClients)
  }
  findClients(sourceFile)

  const findCalls = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === 'apiFetch') {
      throw new Error(`apiFetch remains in ${normalizePath(path.relative(packageDir, sourceFile.fileName))}`)
    }
    if (ts.isCallExpression(node)) {
      const operationId = operationIdFromCall(node, clients)
      if (operationId) addUsage(usages, operationId, 'sdk', sourceRef(sourceFile, node))
    }
    ts.forEachChild(node, findCalls)
  }
  findCalls(sourceFile)
}

function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (!ts.isTemplateExpression(node)) return
  return [node.head.text, ...node.templateSpans.flatMap(span => ['${}', span.literal.text])].join('')
}

function findLiteralSources(sourceFile: ts.SourceFile, matches: (value: string) => boolean): SourceRef[] {
  const sources: SourceRef[] = []
  const visit = (node: ts.Node) => {
    const value = literalText(node)
    if (value && matches(value)) sources.push(sourceRef(sourceFile, node))
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return sortedSources(sources)
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text
  }
}

function objectLiteralKeys(node: ts.ObjectLiteralExpression): string[] {
  return node.properties.flatMap(property => {
    if (ts.isSpreadAssignment(property)) return []
    if (ts.isShorthandPropertyAssignment(property)) return [property.name.text]
    if (
      ts.isPropertyAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property)
    ) {
      const name = propertyName(property.name)
      return name ? [name] : []
    }
    return []
  })
}

function collectRawQuery(sourceFile: ts.SourceFile, queryBuilder: string): string[] {
  const variables = new Map<string, Set<string>>()
  const keysFor = (name: string) => {
    const current = variables.get(name)
    if (current) return current
    const created = new Set<string>()
    variables.set(name, created)
    return created
  }
  const collectObjects = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const name = node.name.text
      objectLiteralKeys(node.initializer).forEach(key => keysFor(name).add(key))
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression)) {
        keysFor(node.left.expression.text).add(node.left.name.text)
      }
      if (
        ts.isElementAccessExpression(node.left) &&
        ts.isIdentifier(node.left.expression) &&
        node.left.argumentExpression &&
        ts.isStringLiteral(node.left.argumentExpression)
      ) {
        keysFor(node.left.expression.text).add(node.left.argumentExpression.text)
      }
    }
    ts.forEachChild(node, collectObjects)
  }
  collectObjects(sourceFile)

  const result = new Set<string>()
  const collectCalls = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === queryBuilder) {
      const argument = node.arguments[0]
      if (argument && ts.isObjectLiteralExpression(argument)) {
        objectLiteralKeys(argument).forEach(key => result.add(key))
      } else if (argument && ts.isIdentifier(argument)) {
        const keys = variables.get(argument.text)
        if (!keys) throw new Error(`Cannot resolve ${queryBuilder} argument ${argument.text} in ${sourceFile.fileName}`)
        keys.forEach(key => result.add(key))
      } else {
        throw new Error(`Unsupported ${queryBuilder} argument in ${sourceFile.fileName}`)
      }
    }
    ts.forEachChild(node, collectCalls)
  }
  collectCalls(sourceFile)
  return sorted(result)
}

function resolvePointer(document: JsonObject, reference: string): unknown {
  if (!reference.startsWith('#/')) return
  return reference
    .slice(2)
    .split('/')
    .map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((current, part) => asObject(current)?.[part], document)
}

function dereferenceObject(document: JsonObject, value: unknown, seen = new Set<string>()): JsonObject | undefined {
  const object = asObject(value)
  if (!object) return
  const reference = typeof object.$ref === 'string' ? object.$ref : undefined
  if (!reference) return object
  if (seen.has(reference)) return
  return dereferenceObject(document, resolvePointer(document, reference), new Set([...seen, reference]))
}

function schemaShape(
  document: JsonObject,
  value: unknown,
  seen = new Set<string>(),
): { fields: Set<string>; required: Set<string> } {
  const object = asObject(value)
  if (!object) return { fields: new Set(), required: new Set() }
  const reference = typeof object.$ref === 'string' ? object.$ref : undefined
  if (reference) {
    if (seen.has(reference)) return { fields: new Set(), required: new Set() }
    return schemaShape(document, resolvePointer(document, reference), new Set([...seen, reference]))
  }

  const fields = new Set(Object.keys(asObject(object.properties) ?? {}))
  const required = new Set(
    Array.isArray(object.required) ? object.required.filter((item): item is string => typeof item === 'string') : [],
  )
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    const variants = object[key]
    if (!Array.isArray(variants)) continue
    for (const variant of variants) {
      const shape = schemaShape(document, variant, seen)
      shape.fields.forEach(field => fields.add(field))
      shape.required.forEach(field => required.add(field))
    }
  }
  return { fields, required }
}

function bodyContract(document: JsonObject, operation: JsonObject): BodyContract | null {
  const requestBody = dereferenceObject(document, operation.requestBody)
  const content = asObject(requestBody?.content)
  if (!content) return null
  const contentTypes = Object.keys(content).sort((left, right) => left.localeCompare(right))
  const shapes = contentTypes.map(contentType => schemaShape(document, asObject(content[contentType])?.schema))
  return {
    contentTypes,
    fields: sorted(shapes.flatMap(shape => [...shape.fields])),
    required: sorted(shapes.flatMap(shape => [...shape.required])),
  }
}

function operationParameters(document: JsonObject, operation: IndexedOperation): JsonObject[] {
  const pathParameters = Array.isArray(operation.pathItem.parameters) ? operation.pathItem.parameters : []
  const endpointParameters = Array.isArray(operation.operation.parameters) ? operation.operation.parameters : []
  return [...pathParameters, ...endpointParameters].flatMap(parameter => {
    const resolved = dereferenceObject(document, parameter)
    return resolved ? [resolved] : []
  })
}

function parameterNames(document: JsonObject, operation: IndexedOperation, location: string): string[] {
  return sorted(
    operationParameters(document, operation).flatMap(parameter =>
      parameter.in === location && typeof parameter.name === 'string' ? [parameter.name] : [],
    ),
  )
}

function indexOpenApi(document: JsonObject): Map<string, IndexedOperation> {
  const paths = asObject(document.paths)
  if (!paths) throw new Error('Current Chimera OpenAPI has no paths object')
  const result = new Map<string, IndexedOperation>()
  for (const [route, value] of Object.entries(paths)) {
    const pathItem = asObject(value)
    if (!pathItem) continue
    for (const method of httpMethods) {
      const operation = asObject(pathItem[method])
      const operationId = typeof operation?.operationId === 'string' ? operation.operationId : undefined
      if (!operation || !operationId) continue
      if (result.has(operationId)) throw new Error(`Duplicate OpenAPI operationId ${operationId}`)
      result.set(operationId, { method: method.toUpperCase(), path: route, pathItem, operation })
    }
  }
  return result
}

function toClientOperationId(operationId: string): string {
  return operationId
    .split('.')
    .map(segment => segment.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase()))
    .join('.')
}

function resolveIndexedOperation(
  operations: Map<string, IndexedOperation>,
  clientMethod: string,
): { operationId: string; operation: IndexedOperation } {
  const direct = operations.get(clientMethod)
  if (direct) return { operationId: clientMethod, operation: direct }
  const matches = [...operations.entries()].filter(([operationId]) => toClientOperationId(operationId) === clientMethod)
  if (matches.length === 1) return { operationId: matches[0][0], operation: matches[0][1] }
  if (matches.length > 1) throw new Error(`${clientMethod} matches multiple current Chimera OpenAPI operations`)
  throw new Error(`${clientMethod} is used by NewWeb but missing from current Chimera OpenAPI`)
}

export async function loadCurrentOpenApi(): Promise<JsonObject> {
  const output = await execFile('bun', ['dev', 'generate'], {
    cwd: chimeraPackageDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const stdout = output.stdout
  const value: unknown = JSON.parse(stdout)
  const document = asObject(value)
  if (!document) throw new Error('Current Chimera OpenAPI is not an object')
  return document
}

export async function loadCurrentOpenApiOperations(): Promise<Map<string, { method: string; path: string }>> {
  return new Map(
    [...indexOpenApi(await loadCurrentOpenApi()).entries()].map(([operationId, operation]) => [
      operationId,
      { method: operation.method, path: operation.path },
    ]),
  )
}

async function loadApiSources(): Promise<Map<string, ts.SourceFile>> {
  const files = ts.sys
    .readDirectory(apiDir, ['.ts'], undefined, ['**/*'])
    .filter(file => !file.endsWith('.test.ts'))
    .sort((left, right) => left.localeCompare(right))
  const sources = await Promise.all(
    files.map(async file => {
      const source = ts.createSourceFile(
        file,
        await readFile(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      )
      return [normalizePath(path.relative(packageDir, file)), source] as const
    }),
  )
  return new Map(sources)
}

function scanUsages(sources: Map<string, ts.SourceFile>): Map<string, Usage> {
  const usages = new Map<string, Usage>()
  sources.forEach(sourceFile => scanSdkCalls(sourceFile, usages))
  for (const special of specialTransports) {
    const sourceFile = sources.get(special.file)
    if (!sourceFile) throw new Error(`Missing special transport source ${special.file}`)
    const literalSources = findLiteralSources(sourceFile, special.matches)
    const firstSource = literalSources[0]
    if (!firstSource) throw new Error(`Cannot find ${special.operationId} transport path in ${special.file}`)
    const usage = addUsage(usages, special.operationId, special.transport, firstSource)
    literalSources.slice(1).forEach(source => addUsage(usages, special.operationId, special.transport, source))
    if (special.queryBuilder) collectRawQuery(sourceFile, special.queryBuilder).forEach(key => usage.rawQuery.add(key))
    special.middlewareQuery.forEach(key => usage.middlewareQuery.add(key))
  }
  return usages
}

export async function generateApiCallInventory(): Promise<ApiCallInventory> {
  const [document, sources] = await Promise.all([loadCurrentOpenApi(), loadApiSources()])
  const operations = indexOpenApi(document)
  const usages = scanUsages(sources)
  const calls = [...usages.entries()]
    .map(([clientMethod, usage]) => {
      const resolved = resolveIndexedOperation(operations, clientMethod)
      const operationId = resolved.operationId
      const operation = resolved.operation
      const openapiQuery = parameterNames(document, operation, 'query')
      const rawQuery = sorted(usage.rawQuery)
      const middlewareQuery = sorted(usage.middlewareQuery)
      const allowedQuery = new Set([...openapiQuery, ...middlewareQuery])
      const unknownQuery = rawQuery.filter(query => !allowedQuery.has(query))
      if (unknownQuery.length > 0) {
        throw new Error(`${operationId} uses undeclared query parameters: ${unknownQuery.join(', ')}`)
      }
      const scopedQuery = openapiQuery.filter(query => scopeQuery.has(query))
      return {
        operationId,
        clientMethod: usage.transport === 'sdk' ? clientMethod : null,
        transport: usage.transport,
        method: operation.method,
        path: operation.path,
        pathParameters: parameterNames(document, operation, 'path'),
        query: {
          openapi: openapiQuery,
          raw: rawQuery,
          middleware: middlewareQuery,
        },
        body: bodyContract(document, operation.operation),
        scope: {
          kind: scopedQuery.length > 0 ? ('instance' as const) : ('global' as const),
          query: scopedQuery,
        },
        sources: sortedSources(usage.sources),
      }
    })
    .sort((left, right) => left.operationId.localeCompare(right.operationId))

  return {
    schemaVersion: 1,
    openapi: {
      package: 'packages/chimera',
      command: 'bun dev generate',
    },
    calls,
  }
}

export async function serializeApiCallInventory(inventory: ApiCallInventory): Promise<string> {
  const config = await resolveConfig(apiCallInventoryPath)
  return format(JSON.stringify(inventory), { ...(config ?? {}), filepath: apiCallInventoryPath, parser: 'json' })
}

async function main(): Promise<void> {
  const inventory = await generateApiCallInventory()
  const serialized = await serializeApiCallInventory(inventory)
  if (process.argv.includes('--write')) {
    await writeFile(apiCallInventoryPath, serialized)
    console.log(`Wrote ${path.relative(packageDir, apiCallInventoryPath)} with ${inventory.calls.length} operations`)
    return
  }
  const current = await readFile(apiCallInventoryPath, 'utf8').catch(() => '')
  if (current !== serialized) {
    throw new Error('API call inventory is stale; run npm run api:inventory:update')
  }
  console.log(`API call inventory is current (${inventory.calls.length} operations)`)
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

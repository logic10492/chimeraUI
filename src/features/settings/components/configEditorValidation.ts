import type { Config } from '../../../types/api/config'
import { MODEL_STATUS, PERMISSION_ACTIONS } from './configEditorMeta'
import type { JsonRecord, SectionID } from './configEditorTypes'

export type ValidationError = { path: string; segments?: string[]; message: string }
export type ValidationDrillTarget = { section: SectionID; stack: { id: string; title: string }[]; key: string }

const BUILTIN_LSP_SERVERS = new Set([
  'deno',
  'typescript',
  'vue',
  'eslint',
  'oxlint',
  'biome',
  'gopls',
  'ruby-lsp',
  'ty',
  'pyright',
  'elixir-ls',
  'zls',
  'csharp',
  'razor',
  'fsharp',
  'sourcekit-lsp',
  'rust',
  'clangd',
  'svelte',
  'astro',
  'jdtls',
  'kotlin-ls',
  'yaml-ls',
  'lua-ls',
  'php intelephense',
  'prisma',
  'dart',
  'ocaml-lsp',
  'bash',
  'terraform',
  'texlab',
  'dockerfile',
  'gleam',
  'clojure-lsp',
  'nixd',
  'tinymist',
  'haskell-language-server',
  'julials',
])

export function validateConfig(config: Config, lang: string, original?: Config): ValidationError[] {
  const errors: ValidationError[] = []
  const root = config as JsonRecord
  const originalRoot = (original ?? {}) as JsonRecord
  const add = (path: string, en: string, zh: string) => errors.push({ path, message: tx(en, zh, lang) })
  const requireString = (path: string, value: unknown) => {
    if (typeof value !== 'string') add(path, 'must be a string', '必须是字符串')
  }
  const requireStringArray = (path: string, value: unknown) => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) add(path, 'must be an array of strings', '必须是字符串数组')
  }
  const requireStringMap = (path: string, value: unknown) => {
    if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'string')) add(path, 'must be an object with string values', '必须是字符串值对象')
  }
  const requireBooleanMap = (path: string, value: unknown) => {
    if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'boolean')) add(path, 'must be an object with boolean values', '必须是布尔值对象')
  }
  const requireAction = (path: string, value: unknown) => {
    if (!PERMISSION_ACTIONS.includes(String(value))) add(path, 'must be ask, allow, or deny', '必须是 ask、allow 或 deny')
  }

  if (root.logLevel !== undefined && !['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(String(root.logLevel))) add('logLevel', 'must be DEBUG, INFO, WARN, or ERROR', '必须是 DEBUG、INFO、WARN 或 ERROR')
  if (root.share !== undefined && !['manual', 'auto', 'disabled'].includes(String(root.share))) add('share', 'must be manual, auto, or disabled', '必须是 manual、auto 或 disabled')
  if (root.autoupdate !== undefined && typeof root.autoupdate !== 'boolean' && root.autoupdate !== 'notify') add('autoupdate', 'must be true, false, or notify', '必须是 true、false 或 notify')
  for (const key of ['instructions', 'disabled_providers', 'enabled_providers']) if (root[key] !== undefined) requireStringArray(key, root[key])
  if (root.tools !== undefined) requireBooleanMap('tools', root.tools)

  const server = getObject(config, 'server')
  if (server.port !== undefined && (!isPositiveInteger(server.port) || Number(server.port) > 65535)) add('server.port', 'must be an integer from 1 to 65535', '必须是 1 到 65535 的整数')
  if (server.cors !== undefined) requireStringArray('server.cors', server.cors)

  const skills = getObject(config, 'skills')
  if (skills.paths !== undefined) requireStringArray('skills.paths', skills.paths)
  if (skills.urls !== undefined) requireStringArray('skills.urls', skills.urls)

  const watcher = getObject(config, 'watcher')
  if (watcher.ignore !== undefined) requireStringArray('watcher.ignore', watcher.ignore)

  const positiveIntegerPaths: [string, unknown][] = [
    ['tool_output.max_lines', getObject(root, 'tool_output').max_lines],
    ['tool_output.max_bytes', getObject(root, 'tool_output').max_bytes],
    ['attachment.image.max_width', getObject(getObject(root, 'attachment'), 'image').max_width],
    ['attachment.image.max_height', getObject(getObject(root, 'attachment'), 'image').max_height],
    ['attachment.image.max_base64_bytes', getObject(getObject(root, 'attachment'), 'image').max_base64_bytes],
    ['experimental.mcp_timeout', getObject(root, 'experimental').mcp_timeout],
  ]
  for (const [path, value] of positiveIntegerPaths) if (value !== undefined && !isPositiveInteger(value)) add(path, 'must be a positive integer', '必须是正整数')

  const compaction = getObject(root, 'compaction')
  for (const key of ['tail_turns', 'preserve_recent_tokens', 'reserved']) {
    if (compaction[key] !== undefined && !isNonNegativeInteger(compaction[key])) add(`compaction.${key}`, 'must be a non-negative integer', '必须是非负整数')
  }

  const commands = getObject(config, 'command')
  for (const [commandID, commandValue] of Object.entries(commands)) {
    const command = isRecord(commandValue) ? commandValue : {}
    requireString(`command.${commandID}.template`, command.template)
  }

  const permission = root.permission
  if (typeof permission === 'string') requireAction('permission', permission)
  else if (isRecord(permission)) {
    for (const [tool, value] of Object.entries(permission)) {
      if (typeof value === 'string') requireAction(`permission.${tool}`, value)
      else if (isRecord(value)) for (const [pattern, action] of Object.entries(value)) requireAction(`permission.${tool}.${pattern}`, action)
      else add(`permission.${tool}`, 'must be an action or pattern map', '必须是动作或 pattern map')
    }
  }

  const providers = getObject(config, 'provider')
  for (const [providerID, providerValue] of Object.entries(providers)) {
    const provider = isRecord(providerValue) ? providerValue : {}
    for (const key of ['env', 'whitelist', 'blacklist']) if (provider[key] !== undefined) requireStringArray(`provider.${providerID}.${key}`, provider[key])
    const options = getObject(provider, 'options')
    if (options.headers !== undefined) requireStringMap(`provider.${providerID}.options.headers`, options.headers)
    for (const key of ['timeout', 'headerTimeout']) {
      const value = options[key]
      if (value !== undefined && value !== false && !isPositiveInteger(value)) add(`provider.${providerID}.options.${key}`, 'must be a positive integer or false', '必须是正整数或 false')
    }
    if (options.chunkTimeout !== undefined && !isPositiveInteger(options.chunkTimeout)) add(`provider.${providerID}.options.chunkTimeout`, 'must be a positive integer', '必须是正整数')
    const models = getObject(provider, 'models')
    for (const [modelID, modelValue] of Object.entries(models)) {
      const model = isRecord(modelValue) ? modelValue : {}
      if (model.status !== undefined && !MODEL_STATUS.includes(String(model.status))) add(`provider.${providerID}.models.${modelID}.status`, 'must be active, alpha, beta, or deprecated', '必须是 active、alpha、beta 或 deprecated')
      const cost = getObject(model, 'cost')
      if ('cost' in model) {
        for (const key of ['input', 'output']) if (cost[key] === undefined) add(`provider.${providerID}.models.${modelID}.cost.${key}`, 'is required', '必填')
        for (const key of ['input', 'output', 'cache_read', 'cache_write']) if (cost[key] !== undefined && !isFiniteNumber(cost[key])) add(`provider.${providerID}.models.${modelID}.cost.${key}`, 'must be a number', '必须是数字')
        const over = getObject(cost, 'context_over_200k')
        if ('context_over_200k' in cost) {
          for (const key of ['input', 'output']) if (over[key] === undefined) add(`provider.${providerID}.models.${modelID}.cost.context_over_200k.${key}`, 'is required', '必填')
          for (const key of ['input', 'output', 'cache_read', 'cache_write']) if (over[key] !== undefined && !isFiniteNumber(over[key])) add(`provider.${providerID}.models.${modelID}.cost.context_over_200k.${key}`, 'must be a number', '必须是数字')
        }
      }
      const limit = getObject(model, 'limit')
      if ('limit' in model) {
        for (const key of ['context', 'output']) if (limit[key] === undefined) add(`provider.${providerID}.models.${modelID}.limit.${key}`, 'is required', '必填')
        for (const key of ['context', 'input', 'output']) if (limit[key] !== undefined && !isFiniteNumber(limit[key])) add(`provider.${providerID}.models.${modelID}.limit.${key}`, 'must be a number', '必须是数字')
      }
      if (model.headers !== undefined) requireStringMap(`provider.${providerID}.models.${modelID}.headers`, model.headers)
    }
  }

  const mcps = getObject(config, 'mcp')
  const originalMcps = getObject(originalRoot, 'mcp')
  for (const [name, value] of Object.entries(mcps)) {
    const mcp = isRecord(value) ? value : {}
    const originalMcp = isRecord(originalMcps[name]) ? (originalMcps[name] as JsonRecord) : {}
    const originalType = typeof originalMcp.type === 'string' ? originalMcp.type : 'enabled-only'
    const nextType = typeof mcp.type === 'string' ? mcp.type : 'enabled-only'
    if (name in originalMcps && originalType !== nextType) add(`mcp.${name}.type`, 'cannot switch saved MCP entry shape through the merge API; add a new entry or reset before saving', '不能通过 merge API 切换已保存 MCP 条目形态；请新增条目或保存前 Reset')
    if (mcp.enabled !== undefined && typeof mcp.enabled !== 'boolean') add(`mcp.${name}.enabled`, 'must be a boolean', '必须是布尔值')
    if ('enabled' in mcp && !('type' in mcp)) continue
    if (mcp.type === 'local') requireStringArray(`mcp.${name}.command`, mcp.command)
    else if (mcp.type === 'remote') requireString(`mcp.${name}.url`, mcp.url)
    else add(`mcp.${name}.type`, 'must be local or remote, or use enabled-only shape', '必须是 local 或 remote，或使用 enabled-only 形态')
    if (mcp.environment !== undefined) requireStringMap(`mcp.${name}.environment`, mcp.environment)
    if (mcp.headers !== undefined) requireStringMap(`mcp.${name}.headers`, mcp.headers)
    if (mcp.timeout !== undefined && !isPositiveInteger(mcp.timeout)) add(`mcp.${name}.timeout`, 'must be a positive integer', '必须是正整数')
  }

  const formatter = root.formatter
  if (isRecord(formatter)) {
    for (const [name, value] of Object.entries(formatter)) {
      const entry = isRecord(value) ? value : {}
      if (entry.command !== undefined) requireStringArray(`formatter.${name}.command`, entry.command)
      if (entry.extensions !== undefined) requireStringArray(`formatter.${name}.extensions`, entry.extensions)
      if (entry.environment !== undefined) requireStringMap(`formatter.${name}.environment`, entry.environment)
      if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') add(`formatter.${name}.disabled`, 'must be a boolean', '必须是布尔值')
    }
  }

  const lsp = root.lsp
  const originalLsp = getObject(originalRoot, 'lsp')
  if (isRecord(lsp)) {
    for (const [name, value] of Object.entries(lsp)) {
      const entry = isRecord(value) ? value : {}
      const originalEntry = isRecord(originalLsp[name]) ? (originalLsp[name] as JsonRecord) : {}
      if ('command' in originalEntry && entry.disabled === true && !('command' in entry)) add(`lsp.${name}.mode`, 'cannot switch a saved custom LSP entry to disabled-only through the merge API; set disabled=true in custom mode instead', '不能通过 merge API 把已保存 custom LSP 切成 disabled-only；请在 custom 模式下设置 disabled=true')
      if (originalEntry.disabled === true && 'command' in entry && entry.disabled !== false) add(`lsp.${name}.disabled`, 'must be false when switching a saved disabled-only LSP entry to custom command', '已保存 disabled-only LSP 切到 custom command 时必须显式为 false')
      if (entry.disabled === true) continue
      requireStringArray(`lsp.${name}.command`, entry.command)
      if (entry.extensions !== undefined) requireStringArray(`lsp.${name}.extensions`, entry.extensions)
      if (entry.env !== undefined) requireStringMap(`lsp.${name}.env`, entry.env)
      if (!BUILTIN_LSP_SERVERS.has(name) && entry.disabled !== true && !Array.isArray(entry.extensions)) add(`lsp.${name}.extensions`, 'is required for custom LSP servers', '自定义 LSP 服务必填')
    }
  }
  return errors
}

export function validationDrillTargetForError(error: ValidationError): Omit<ValidationDrillTarget, 'key'> {
  const segments = error.segments?.length ? error.segments : error.path === '$' ? [] : error.path.split('.')
  const section = sectionForValidationPath(error.path)
  const stack: { id: string; title: string }[] = []
  const push = (id: string | undefined, title?: string) => {
    if (!id) return
    stack.push({ id, title: title ?? id })
  }

  if (segments[0] === 'command') push(segments[1] ? `command:${segments[1]}` : undefined, segments[1])
  else if (segments[0] === 'reference') push(segments[1] ? `reference:${segments[1]}` : undefined, segments[1] ? `@${segments[1]}` : undefined)
  else if (segments[0] === 'plugin' && segments[1]) push(`plugin:${segments[1]}`, 'plugin')
  else if (segments[0] === 'provider' && segments[1]) {
    push(`provider:${segments[1]}`, segments[1])
    const modelIndex = segments.indexOf('models')
    if (modelIndex >= 0) {
      push('models', 'models')
      const modelID = segments[modelIndex + 1]
      push(modelID ? `model:${modelID}` : undefined, modelID)
      const variantIndex = segments.indexOf('variants')
      if (variantIndex >= 0) {
        push('variants', 'variants')
        const variantID = segments[variantIndex + 1]
        push(variantID ? `variant:${variantID}` : undefined, variantID)
      }
    } else if (segments[2]) push(segments[2], segments[2])
  } else if (segments[0] === 'agent') {
    push(segments[1] ? `agent:${segments[1]}` : undefined, segments[1])
    if (segments[2]) push(segments[2], segments[2])
  } else if (segments[0] === 'mcp') push(segments[1] ? `mcp:${segments[1]}` : undefined, segments[1])
  else if (segments[0] === 'permission' && segments[1] && segments.length > 2) push(`permission-patterns:${segments[1]}`, `${segments[1]}.patterns`)
  else if (segments[0] === 'formatter') push(segments[1] ? `formatter:${segments[1]}` : undefined, segments[1])
  else if (segments[0] === 'lsp') push(segments[1] ? `lsp:${segments[1]}` : undefined, segments[1])
  else if (segments[0] === 'mode') push(segments[1] ? `mode-agent:${segments[1]}` : undefined, segments[1])

  return { section, stack }
}

function sectionForValidationPath(path: string): SectionID {
  if (path.startsWith('server.')) return 'server'
  if (path.startsWith('command.')) return 'commands'
  if (path.startsWith('provider.')) return 'providers'
  if (path.startsWith('agent.')) return 'agents'
  if (path.startsWith('mcp.')) return 'mcp'
  if (path.startsWith('permission.')) return 'permissions'
  if (path.startsWith('formatter.')) return 'formatters'
  if (path.startsWith('lsp.')) return 'lsp'
  if (path.startsWith('attachment.')) return 'attachments'
  if (path.startsWith('tool_output.') || path.startsWith('compaction.') || path.startsWith('watcher.') || path.startsWith('enterprise.')) return 'runtime'
  if (path.startsWith('memories.')) return 'memories'
  if (path.startsWith('experimental.')) return 'experimental'
  if (path === '$schema' || path === 'autoshare' || path === 'layout' || path.startsWith('mode.')) return 'compatibility'
  return 'general'
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getObject(record: unknown, key: string): JsonRecord {
  if (!isRecord(record)) return {}
  const value = record[key]
  return isRecord(value) ? value : {}
}

function isPositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function tx(en: string, zh: string, lang: string) {
  return lang.startsWith('zh') ? zh : en
}

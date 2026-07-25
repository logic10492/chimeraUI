import { describe, expect, it } from 'vitest'
import type { Config } from '../../../types/api/config'
import { validateConfig, validationDrillTargetForError } from './configEditorValidation'

function config(value: unknown): Config {
  return value as Config
}

describe('configEditorValidation Stage 4 fields', () => {
  it('accepts supported runtime and provider capability shapes', () => {
    expect(validateConfig(config({
      compaction: { remote: 'auto', remote_protocol: 'v2' },
      provider: {
        custom: {
          wire_api: 'responses',
          remote_compaction: {
            profile: 'codex-responses',
            protocols: ['legacy', 'v2'],
            auth: 'provider-bearer',
          },
          models: {
            model: { wire_api: 'responses', remote_compaction: true },
          },
        },
      },
    }), 'en')).toEqual([])
  })

  it('rejects unsupported enums and malformed capability metadata', () => {
    const paths = validateConfig(config({
      compaction: { remote: 'forced', remote_protocol: 'v3' },
      provider: {
        custom: {
          wire_api: 'completions',
          remote_compaction: {
            profile: 'other',
            protocols: ['v2', 'v2'],
            auth: 'api-key',
          },
          models: {
            model: { wire_api: 'completions', remote_compaction: 'yes' },
          },
        },
      },
    }), 'en').map(error => error.path)

    expect(paths).toEqual(expect.arrayContaining([
      'compaction.remote',
      'compaction.remote_protocol',
      'provider.custom.wire_api',
      'provider.custom.remote_compaction.profile',
      'provider.custom.remote_compaction.protocols',
      'provider.custom.remote_compaction.auth',
      'provider.custom.models.model.wire_api',
      'provider.custom.models.model.remote_compaction',
    ]))
  })

  it('routes runtime and provider errors to their editors', () => {
    expect(validationDrillTargetForError({ path: 'compaction.remote', message: '' })).toEqual({ section: 'runtime', stack: [] })
    expect(validationDrillTargetForError({ path: 'provider.custom.remote_compaction.protocols', message: '' })).toEqual({
      section: 'providers',
      stack: [
        { id: 'provider:custom', title: 'custom' },
        { id: 'remote_compaction', title: 'remote_compaction' },
      ],
    })
    expect(validationDrillTargetForError({ path: 'provider.custom.models.model.remote_compaction', message: '' })).toEqual({
      section: 'providers',
      stack: [
        { id: 'provider:custom', title: 'custom' },
        { id: 'models', title: 'models' },
        { id: 'model:model', title: 'model' },
      ],
    })
  })
})

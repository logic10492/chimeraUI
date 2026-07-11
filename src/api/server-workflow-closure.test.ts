import { describe, expect, test } from 'vitest'
import { loadServerWorkflowClosure, validateServerWorkflowClosure } from '../../scripts/server-workflow-closure'

describe('NewWeb existing-server workflow closure', () => {
  test('keeps required workflow families and Phase 0 closure current', async () => {
    const [artifact, result] = await Promise.all([loadServerWorkflowClosure(), validateServerWorkflowClosure()])
    const phase0ServerChanges = artifact.workflows.filter(
      workflow => workflow.phase === 0 && (workflow.classification === 'fix' || workflow.classification === 'add'),
    )

    expect(artifact.authority).toMatchObject({
      source: 'current-chimera-server-openapi-sdk',
      openapi: { package: 'packages/chimera', command: 'bun dev generate' },
      excludedAuthorities: ['tui-inventory', 'second-server-contract'],
    })
    expect(phase0ServerChanges.map(workflow => [workflow.id, workflow.classification, workflow.status.server])).toEqual(
      [['pty-connect-query-openapi-parity', 'fix', 'closed']],
    )
    expect(artifact.phase0.serverAdds).toEqual([])
    expect(artifact.workflows.map(workflow => workflow.id)).toEqual(
      expect.arrayContaining([
        'bootstrap-discovery',
        'session-chat-core',
        'interaction-history',
        'global-sse-events',
        'sse-overflow-gap-resync-signal',
        'pty-crud',
        'mcp-connectivity',
        'file-context-search',
        'workspace-symbol-search',
        'worktree-workflows',
        'workspace-lifecycle',
      ]),
    )
    expect(artifact.workflows.find(workflow => workflow.id === 'provider-auth-oauth-disconnect')).toMatchObject({
      classification: 'reuse',
      phase: 2,
      status: { server: 'existing', ui: 'deferred' },
    })
    expect(artifact.workflows.find(workflow => workflow.id === 'graph-workflows')).toMatchObject({
      classification: 'reuse',
      phase: 5,
      status: { server: 'existing', ui: 'deferred' },
    })
    expect(artifact.workflows.find(workflow => workflow.id === 'workspace-symbol-search')).toMatchObject({
      classification: 'fix',
      phase: 5,
      status: { server: 'planned', ui: 'deferred' },
    })
    expect(artifact.workflows.find(workflow => workflow.id === 'sse-overflow-gap-resync-signal')).toMatchObject({
      classification: 'add',
      phase: 3,
      status: { server: 'planned', ui: 'deferred' },
      operations: [],
    })
    expect(artifact.workflows.find(workflow => workflow.id === 'workspace-lifecycle')).toMatchObject({
      classification: 'reuse',
      phase: 2,
      status: { server: 'existing', ui: 'deferred' },
    })
    expect(artifact.workflows.find(workflow => workflow.id === 'pty-connect-ticket-migration')).toMatchObject({
      classification: 'reuse',
      phase: 2,
      status: { server: 'existing', ui: 'deferred' },
    })
    expect(result).toEqual({ workflows: 20, operations: 94 })
  }, 30_000)
})

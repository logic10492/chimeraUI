import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import {
  apiCallInventoryPath,
  generateApiCallInventory,
  serializeApiCallInventory,
} from '../../scripts/api-call-inventory'

describe('NewWeb API call inventory', () => {
  test('matches current source calls and Chimera OpenAPI', async () => {
    const inventory = await generateApiCallInventory()
    const globalEvent = inventory.calls.find(call => call.operationId === 'global.event')
    const ptyConnect = inventory.calls.find(call => call.operationId === 'pty.connect')

    expect(inventory.calls.length).toBeGreaterThan(0)
    expect(inventory.calls.filter(call => call.clientMethod === null).map(call => call.operationId)).toEqual([
      'global.event',
      'pty.connect',
    ])
    expect(globalEvent).toMatchObject({ transport: 'sse', method: 'GET', path: '/global/event' })
    expect(ptyConnect).toMatchObject({
      transport: 'websocket',
      method: 'GET',
      path: '/pty/{ptyID}/connect',
      query: {
        raw: ['auth_token', 'cursor', 'directory'],
        middleware: ['auth_token'],
      },
    })
    expect(ptyConnect?.query.openapi).toEqual(expect.arrayContaining(['cursor', 'directory', 'ticket', 'workspace']))
    expect(await readFile(apiCallInventoryPath, 'utf8')).toBe(await serializeApiCallInventory(inventory))
  }, 30_000)
})

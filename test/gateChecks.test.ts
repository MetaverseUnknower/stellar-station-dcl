// The gate re-checks docking every 30 s while aboard; a server that stops answering must not stack those checks up.
import { it, expect, vi } from 'vitest'
import { tick } from './helpers'

let statusCalls = 0
vi.mock('../src/auth', () => ({ authenticate: vi.fn(async () => ({ hasPlayer: true })), getToken: () => 'token' }))
vi.mock('../src/stationApi', async (orig) => ({
  ...(await orig<any>()),
  // The first check answers (aboard); every later one hangs, as with a stuck server
  getStationStatus: vi.fn(() => {
    statusCalls++
    return statusCalls === 1 ? Promise.resolve({ isDocked: true, stationId: 'st1', isAdmin: false }) : new Promise(() => {})
  }),
  listStations: vi.fn(async () => []),
}))

import { startGate } from '../src/gate'

it('never has two status checks in flight, however slow the server is', async () => {
  await startGate()
  await tick(180)          // six re-checks would be due
  expect(statusCalls).toBe(2)   // the first, then one that's still waiting
})

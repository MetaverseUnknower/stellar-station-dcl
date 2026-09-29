// A visitor with no Galaxy Gardeners captain is welcomed and pointed at the ship world, where the game starts.
import { it, expect, vi } from 'vitest'
import { calls } from './system/RestrictedActions'

vi.mock('../src/auth', () => ({ authenticate: vi.fn(async () => ({ hasPlayer: false })), getToken: () => 'token' }))

import { startGate, getGateState } from '../src/gate'

it('welcomes a visitor with no captain and points them at the ship world', async () => {
  await startGate()
  expect(getGateState()).toMatchObject({ kind: 'refused', newcomer: true })
  const realm = calls.find(c => c.name === 'changeRealm')
  expect(realm?.args.realm).toBe('galaxygardeners.dcl.eth')
  expect(realm?.args.message).toMatch(/Claim your free ship/)
})

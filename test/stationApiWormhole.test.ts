// getWormholeMap: only the server's "not owned" 403 means the player doesn't own the map. Any other failure (the auth
// middleware's own 403 "No player account found", a 500) is thrown, so the overlay keeps what it has drawn.
import { it, expect, vi } from 'vitest'
import { setSignedFetchHandler } from '~system/SignedFetch'

vi.mock('../src/auth', () => ({ authenticate: vi.fn(async () => ({ hasPlayer: true })), getToken: () => 'token' }))

import { getWormholeMap } from '../src/stationApi'

const reply = (status: number, body: string) =>
  setSignedFetchHandler(async () => ({ ok: status < 400, status, statusText: '', headers: {}, body }))

it('returns the map on 200', async () => {
  const map = { links: [], dormant: [], events: [] }
  reply(200, JSON.stringify(map))
  expect(await getWormholeMap()).toEqual(map)
})

it('is null for a 403 "not owned" (JSON body)', async () => {
  reply(403, '{"error":"not owned"}')
  expect(await getWormholeMap()).toBeNull()
})

it('is null for a 403 "not owned" (bare-string body)', async () => {
  reply(403, 'not owned')
  expect(await getWormholeMap()).toBeNull()
})

it('rejects on the auth middleware\'s 403 "No player account found"', async () => {
  reply(403, '{"error":"No player account found"}')
  await expect(getWormholeMap()).rejects.toThrow('No player account found')
})

it('rejects on a 500', async () => {
  reply(500, '{"error":"boom"}')
  await expect(getWormholeMap()).rejects.toThrow('boom')
})

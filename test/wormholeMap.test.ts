// The Eld's wormhole map on the galaxy hologram, for an owner: drawn once aboard, polled every 5 minutes one request at a
// time, redrawn only when it changes, new stars fetched when the map names one, the open wormhole pulsing a few times a
// second, and gone (with the polling) when the server says it's no longer owned.
import { it, expect, vi } from 'vitest'
import { Material, TextShape } from '@dcl/sdk/ecs'
import { tick } from './helpers'

const sys = (id: string, x: number, wormhole = false) => ({
  id, name: `Star ${id}`, coord_r: 0, coord_theta: 0, coord_x: x, coord_y: x / 2, coord_z: 0, origin: false,
  discovered_by: null, discovered_by_name: null, has_station: false, solar_recharge_rate: 1, has_wormhole: wormhole,
  star_type: null, created_at: ''
})
let systems = [sys('a', 10, true), sys('b', -10, true), sys('c', 5, true), sys('t', -5), sys('o', 0)]
let systemsCalls = 0
let mineCalls = 0
let mineFails = true          // the first ownership check fails (network); the overlay retries it after 60 s
let mapCalls = 0
let mapFails = true           // the first map fetch fails too; the overlay tries again after a minute, not five
let docked = true             // the mocked station status: false sends the gate to 'refused'
const pair = { a: { id: 'a', name: 'Star a' }, b: { id: 'b', name: 'Star b' } }
const scheduled = { id: 'e1', target: { id: 't', name: 'Star t' }, startsAt: '2026-10-01T14:00:00Z', endsAt: '2026-10-01T15:00:00Z', status: 'scheduled', exclusive: true, eldBuilt: true }
let map: any = { links: [pair], dormant: [{ id: 'c', name: 'Star c' }], events: [scheduled] }
let reply: () => Promise<any> = async () => map

vi.mock('../src/auth', () => ({ authenticate: vi.fn(async () => ({ hasPlayer: true })), getToken: () => 'token' }))
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getPlayerMe: vi.fn(async () => ({ id: 'p1', galaxy_id: 'g1', home_system_id: null, current_system_id: null })),
  getSystems: vi.fn(async () => { systemsCalls++; return systems }),
  getSystemPopulation: vi.fn(async () => ({ windowHours: 24, systems: [] })),
}))
vi.mock('../src/stationApi', async (orig) => ({
  ...(await orig<any>()),
  getStationStatus: vi.fn(async () => ({ isDocked: docked, stationId: 'st1', isAdmin: false })),
  listStations: vi.fn(async () => []),
  getMarketMine: vi.fn(async () => {
    mineCalls++
    if (mineFails) { mineFails = false; throw new Error('offline') }
    return { cloakedUntil: null, insurancePolicies: 0, wormholeMap: true }
  }),
  getWormholeMap: vi.fn(() => {
    mapCalls++
    if (mapFails) { mapFails = false; return Promise.reject(new Error('offline')) }
    return reply()
  }),
}))

import { startGate } from '../src/gate'
import { buildGalaxyHologram } from '../src/observation/galaxyHologram'
import { wormholeMapParts } from '../src/observation/wormholeMap'

it('retries the ownership check after a failed one, then draws every known wormhole once the stars are up', async () => {
  buildGalaxyHologram()
  await startGate()
  await tick(1)
  expect(mapCalls).toBe(0)            // the first check failed
  await tick(61)                      // retried a minute later
  expect(mineCalls).toBe(2)
  expect(mapCalls).toBe(1)            // the first map fetch failed: nothing drawn
  expect(wormholeMapParts().beam).toBe(0)
  await tick(30, 2)
  expect(mapCalls).toBe(1)            // not yet: the retry is a minute after the failure, not five
  await tick(31, 2)
  expect(mapCalls).toBe(2)
  const parts = wormholeMapParts()
  expect(parts.beam).toBe(1)          // a ⇄ b
  expect(parts.ring).toBe(4)          // c, dormant: four arcs
  expect(parts.dash).toBeGreaterThan(2) // the scheduled wormhole to t
  expect(parts.cap).toBe(1)           // it's private
  expect(parts.labels).toEqual(expect.arrayContaining(['Star a', 'Star b', 'Star c', 'WORMHOLE · opens 14:00 UTC']))
})

it('an unchanged map is fetched every 5 minutes and draws nothing new', async () => {
  const calls = mapCalls
  const before = wormholeMapParts().entities
  const materials = vi.spyOn(Material, 'setPbrMaterial')
  const texts = vi.spyOn(TextShape, 'createOrReplace')
  await tick(600, 2)
  expect(mapCalls).toBe(calls + 2)
  expect(wormholeMapParts().entities).toEqual(before)   // the same entities: nothing was redrawn
  expect(materials.mock.calls.filter((c) => before.includes(c[0]))).toEqual([])
  expect(texts.mock.calls.filter((c) => before.includes(c[0]))).toEqual([])
  vi.restoreAllMocks()
})

it('a black hole found since the hologram loaded makes it reload its stars once, then appears', async () => {
  const before = systemsCalls
  systems = [...systems, sys('n', 20, true)]
  map = { ...map, dormant: [...map.dormant, { id: 'n', name: 'Star n' }] }
  await tick(300, 2)
  expect(systemsCalls).toBe(before + 1)
  expect(wormholeMapParts().ring).toBe(8)
  expect(wormholeMapParts().labels).toContain('Star n')
  await tick(300, 2)                     // the same map again: no second reload
  expect(systemsCalls).toBe(before + 1)
})

it('a star that never turns up asks for one reload per new map, not one per poll', async () => {
  const before = systemsCalls
  map = { ...map, dormant: [...map.dormant, { id: 'ghost', name: 'Ghost' }] }
  await tick(900, 2)
  expect(systemsCalls).toBe(before + 1)
  expect(wormholeMapParts().labels).not.toContain('Ghost')
})

it("an open wormhole to the galaxy's centre star draws its label without a zero-length beam", async () => {
  map = { ...map, events: [{ ...scheduled, id: 'e0', target: { id: 'o', name: 'Star o' }, status: 'open', exclusive: false }] }
  await tick(300, 2)
  const parts = wormholeMapParts()
  expect(parts.labels).toContain('WORMHOLE · until 15:00 UTC')
  expect(parts.beam).toBe(1)          // just a ⇄ b: the centre beam was skipped, not NaN
})

it('every open wormhole pulses through a few fixed looks, a few material writes a second', async () => {
  const open = { ...scheduled, status: 'open', exclusive: false }
  map = { ...map, events: [{ ...open, id: 'e2' }, { ...open, id: 'e3', target: { id: 'c', name: 'Star c' }, eldBuilt: false }] }
  await tick(300, 2)
  expect(wormholeMapParts().beam).toBe(3)   // a ⇄ b, and the two open ones
  const mine = wormholeMapParts().entities
  const materials = vi.spyOn(Material, 'setPbrMaterial')
  await tick(10)
  const calls = materials.mock.calls.filter((c) => mine.includes(c[0]))
  const looks = new Map<any, Set<string>>()
  for (const c of calls) {
    if (!looks.has(c[0])) looks.set(c[0], new Set())
    looks.get(c[0])!.add(JSON.stringify((c[1] as any).albedoColor))
  }
  expect(looks.size).toBe(2)                // both open beams pulse, not only the last
  for (const set of looks.values()) expect(set.size).toBeLessThanOrEqual(11)
  expect(calls.length).toBeGreaterThan(0)
  expect(calls.length).toBeLessThanOrEqual(2 * (10 * 10 + 1))
  vi.restoreAllMocks()
})

it('polls only while aboard: nothing asked once the ship undocks, and it resumes on return', async () => {
  docked = false
  await tick(40, 2)                   // the gate rechecks every 30 s while aboard
  const calls = mapCalls
  await tick(900, 2)
  expect(mapCalls).toBe(calls)
  docked = true
  await tick(20, 2)                   // refused players are rechecked every 10 s
  await tick(300, 2)
  expect(mapCalls).toBeGreaterThan(calls)
})

it('a 403 (no longer owned) clears the overlay and stops polling', async () => {
  reply = async () => null
  await tick(300, 2)
  const calls = mapCalls
  const parts = wormholeMapParts()
  expect(parts.beam + parts.dash + parts.ring + parts.cap + parts.label).toBe(0)
  await tick(900, 2)
  expect(mapCalls).toBe(calls)
})

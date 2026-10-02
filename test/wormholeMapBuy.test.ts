// The Eld's wormhole map for a player who doesn't own it: nothing drawn, nothing polled; bought at the relay, it appears
// at once, "owned" stops a second petition, and a stuck server never has two map requests in flight.
import { it, expect, vi } from 'vitest'
import { tick } from './helpers'

const sys = (id: string, x: number) => ({
  id, name: `Star ${id}`, coord_r: 0, coord_theta: 0, coord_x: x, coord_y: 0, coord_z: 0, origin: false,
  discovered_by: null, discovered_by_name: null, has_station: false, solar_recharge_rate: 1, has_wormhole: true,
  star_type: null, created_at: ''
})
let owns = false
let mapCalls = 0
let reply: () => Promise<any> = async () => ({ links: [{ a: { id: 'a', name: 'Star a' }, b: { id: 'b', name: 'Star b' } }], dormant: [], events: [] })
const MAP_ITEM = { id: 'wormhole_map', name: 'Wormhole map', mana: 60, blurb: 'Every wormhole.', kind: 'map', hours: null, exclusive: false }

vi.mock('../src/auth', () => ({ authenticate: vi.fn(async () => ({ hasPlayer: true })), getToken: () => 'token' }))
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getPlayerMe: vi.fn(async () => ({ id: 'p1', galaxy_id: 'g1', home_system_id: null, current_system_id: null })),
  getSystems: vi.fn(async () => [sys('a', 10), sys('b', -10)]),
  getSystemPopulation: vi.fn(async () => ({ windowHours: 24, systems: [] })),
}))
vi.mock('../src/fuel/payments', async (orig) => ({ ...(await orig<any>()), payMana: vi.fn(async () => '0x' + 'ab'.repeat(32)) }))
vi.mock('../src/stationApi', async (orig) => ({
  ...(await orig<any>()),
  getStationStatus: vi.fn(async () => ({ isDocked: true, stationId: 'st1', isAdmin: false })),
  listStations: vi.fn(async () => []),
  getMarketMine: vi.fn(async () => ({ cloakedUntil: null, insurancePolicies: 0, wormholeMap: owns })),
  getMarketCatalog: vi.fn(async () => ({ items: [MAP_ITEM] })),
  getMarketPending: vi.fn(async () => ({ pending: [] })),
  getFriends: vi.fn(async () => ({ friends: [], incomingRequests: [], outgoingRequests: [] })),
  quoteMarket: vi.fn(async () => ({ summary: 'Every wormhole your galaxy knows.', mana: 60 })),
  buyFromMarket: vi.fn(async () => { owns = true; return { status: 'ok', summary: 'Every wormhole your galaxy knows.' } }),
  getWormholeMap: vi.fn(() => { mapCalls++; return reply() }),
}))

import { startGate } from '../src/gate'
import { buildGalaxyHologram } from '../src/observation/galaxyHologram'
import { wormholeMapParts } from '../src/observation/wormholeMap'
import { market, openMarket, selectItem, askQuote, pay, again } from '../src/blackMarket/market'

it('draws nothing and asks for nothing when the player has no map', async () => {
  buildGalaxyHologram()
  await startGate()
  await tick(600, 2)
  expect(mapCalls).toBe(0)
  expect(wormholeMapParts().beam).toBe(0)
})

it('buying it at the relay shows it straight away, and marks it owned', async () => {
  await openMarket()
  selectItem(market.items[0])
  await askQuote()
  expect(market.phase).toBe('quoted')
  await pay()
  await tick(1)
  expect(market.phase).toBe('done')
  expect(market.ownsMap).toBe(true)
  expect(mapCalls).toBe(1)
  expect(wormholeMapParts().beam).toBe(1)
  again()
  await openMarket()                 // reopened: the server's record agrees
  await tick(1)                      // openMarket fires refreshMine without awaiting it
  expect(market.ownsMap).toBe(true)
  expect(market.mine).toContain('Wormhole map')
  const { quoteMarket } = await import('../src/stationApi')
  const quotes = (quoteMarket as any).mock.calls.length
  selectItem(market.items[0])
  await askQuote()
  expect((quoteMarket as any).mock.calls.length).toBe(quotes)   // no second petition sent
  expect(market.phase).toBe('browse')
})

it('never has two map requests in flight, however slow the server is', async () => {
  reply = () => new Promise(() => {})
  const calls = mapCalls
  await tick(900, 2)                    // three polls would be due
  expect(mapCalls).toBe(calls + 1)   // one, still waiting
})

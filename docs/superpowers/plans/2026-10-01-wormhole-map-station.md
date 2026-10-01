# The Eld's Wormhole Map (station) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners of the Eld's wormhole map see every known wormhole, and where it leads, drawn on the hub's galaxy hologram. The map can be bought at the Eld's relay.

**Architecture:** A new overlay module, `src/observation/wormholeMap.ts`, hooks into the copied ship map (`galaxyMap.ts`, left unchanged) through `addMapRenderHooks`, the same way `heatMap.ts` does. It checks ownership once aboard, polls the server's map every 5 minutes with one request in flight, and redraws only on change. When the map names a star the hologram hasn't loaded yet, it asks `galaxyHologram.ts` to reload its stars. The Eld's panel learns the `'map'` kind and "owned", and a completed purchase starts the overlay.

**Tech Stack:** Decentraland SDK 7.23.2 (ECS, ReactEcs UI), TypeScript, vitest running the real engine headless (`test/helpers.ts`). Node 20.

**Spec:** `docs/superpowers/specs/2026-10-01-wormhole-map-design.md` (section "2. This station scene")

**Depends on:** the server plan (`galaxy-gardeners-server/docs/superpowers/plans/2026-10-01-wormhole-map-server.md`) being on staging, for the manual check in Task 4. Tasks 1–3 need only mocks.

## Global Constraints

- `galaxyMap.ts`, `heatMap.ts` and `prefs.ts` are unchanged copies of the ship's files. Don't edit them.
- Poll every 300 s, with never more than one request in flight. Never poll if the player doesn't own the map.
- An unchanged poll writes no entities, Transforms, TextShapes or Materials. Material writes come only from the open
  wormhole's pulse, at most 10 per second (HANDOFF: "anything running every frame must not re-set materials …";
  "pollers keep one request in flight").
- A 403 from `GET /api/black-market/wormhole-map` means not owned: clear the overlay and stop polling.
- No colliders on overlay parts. No toggle (the hologram has no controls).
- Times are shown in UTC as `HH:MM UTC`.
- Tests that need fresh module state go in their own file. Don't use `vi.resetModules` (HANDOFF).

## Review Focus

- **A timed wormhole whose target is the galaxy's centre star.** A zero-length beam would normalise a zero vector
  (NaN rotation). It must be skipped, and the label still drawn. Test in Task 2.
- **The map arrives before the hologram has drawn its stars** (a slow `getSystems`). Nothing should be drawn yet, and
  the hologram's render hook draws it later without another fetch. Test in Task 2.
- **A star reload that fails.** A missing star must not cause a reload on every frame or every poll. One request per
  new map at most. Test in Task 2 (the reload counter).
- **Ownership check fails (network) at boarding.** The gate notifies listeners only when its state changes, so a
  failed check is never re-triggered by the gate. The overlay retries it itself every 60 s while aboard. Test in
  Task 2.
- **Buying twice in one session.** "Owned" must stop a second petition in the panel before the server has to refuse
  it. Test in Task 3.

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/stationApi.ts` | modify | `'map'` kind, `wormholeMap` on mine, `getWormholeMap()` and its types |
| `src/observation/wormholeMap.ts` | create | the overlay: ownership, polling, drawing |
| `src/observation/galaxyHologram.ts` | modify | `reloadStars()` and calling `setupWormholeMap(reloadStars)` |
| `src/blackMarket/market.ts` | modify | `market.ownsMap`, the "mine" line, start the overlay on purchase |
| `src/blackMarket/panelUi.tsx` | modify | OWNED in place of PETITION |
| `test/wormholeMap.test.ts` | create | an owner's journey |
| `test/wormholeMapBuy.test.ts` | create | not owned, buying it, a stuck server |
| `HANDOFF.md` | modify | the feature, and its tests |

---

### Task 1: API types and `getWormholeMap`

**Files:**
- Modify: `src/stationApi.ts` (the black-market section, ~line 178–219)

**Interfaces:**
- Produces:
  ```ts
  MarketItem['kind']: 'wormhole' | 'destroy' | 'rename' | 'cloak' | 'radio' | 'insurance' | 'map'
  getMarketMine(): Promise<{ cloakedUntil: string | null; insurancePolicies: number; wormholeMap?: boolean }>
  export type MapStar = { id: string; name: string }
  export type MapEvent = { id: string; target: MapStar; startsAt: string; endsAt: string; status: 'open' | 'scheduled'; exclusive: boolean; eldBuilt: boolean }
  export type WormholeMap = { links: { a: MapStar; b: MapStar }[]; dormant: MapStar[]; events: MapEvent[] }
  export function getWormholeMap(): Promise<WormholeMap | null>   // null = not owned (403)
  ```

- [ ] **Step 1: Make the changes**

In `MarketItem`, change `kind` to:

```ts
  kind: 'wormhole' | 'destroy' | 'rename' | 'cloak' | 'radio' | 'insurance' | 'map'
```

Replace `getMarketMine`:

```ts
/** `wormholeMap` is missing from a server older than the map. */
export function getMarketMine(): Promise<{ cloakedUntil: string | null; insurancePolicies: number; wormholeMap?: boolean }> {
  return apiGet('/api/black-market/mine')
}
```

After `getPirateRadio`, add:

```ts
// ---- the Eld's wormhole map (server services/blackMarket/wormholeMap.ts), for players who bought it ----

export type MapStar = { id: string; name: string }
export type MapEvent = {
  id: string
  target: MapStar
  startsAt: string
  endsAt: string
  status: 'open' | 'scheduled'
  exclusive: boolean
  eldBuilt: boolean
}
export type WormholeMap = { links: { a: MapStar; b: MapStar }[]; dormant: MapStar[]; events: MapEvent[] }

/** Every known wormhole in my galaxy, or null when I don't own the map (the server's 403). */
export async function getWormholeMap(): Promise<WormholeMap | null> {
  try {
    return await apiGet<WormholeMap>('/api/black-market/wormhole-map')
  } catch (e) {
    if ((e as { status?: number }).status === 403) return null
    throw e
  }
}
```

- [ ] **Step 2: Type-check**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npx tsc --noEmit -p .`
Expected: no errors. If `tsc` on the project reports pre-existing errors, compare against `git stash`. This task must add none.

- [ ] **Step 3: Commit**

```bash
git add src/stationApi.ts
git commit -m "Wormhole map: the API (map kind, ownership, the map)"
```

### Task 2: The overlay on the galaxy hologram

**Files:**
- Create: `src/observation/wormholeMap.ts`
- Modify: `src/observation/galaxyHologram.ts`
- Test: `test/wormholeMap.test.ts`

**Interfaces:**
- Consumes: `getMarketMine`, `getWormholeMap`, `WormholeMap` (Task 1); `starEntities`, `getGalaxyRoot`, `addMapRenderHooks`, `clearMap`, `renderStarSystems` (`galaxyMap.ts`); `onGateChanged` (`gate.ts`).
- Produces:
  ```ts
  export function setupWormholeMap(reloadStars: () => Promise<void>): void
  export function wormholeMapOwned(): void            // start showing it now (bought, or on record)
  export type Part = 'beam' | 'dash' | 'ring' | 'cap' | 'label'
  export function wormholeMapParts(): Record<Part, number> & { labels: string[]; entities: Entity[] }   // what's drawn (tests)
  ```

- [ ] **Step 1: Write the failing test**

`test/wormholeMap.test.ts`:

```ts
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
  getStationStatus: vi.fn(async () => ({ isDocked: true, stationId: 'st1', isAdmin: false })),
  listStations: vi.fn(async () => []),
  getMarketMine: vi.fn(async () => {
    mineCalls++
    if (mineFails) { mineFails = false; throw new Error('offline') }
    return { cloakedUntil: null, insurancePolicies: 0, wormholeMap: true }
  }),
  getWormholeMap: vi.fn(() => { mapCalls++; return reply() }),
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
  expect(mapCalls).toBe(1)
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
  await tick(600)
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
  await tick(300)
  expect(systemsCalls).toBe(before + 1)
  expect(wormholeMapParts().ring).toBe(8)
  expect(wormholeMapParts().labels).toContain('Star n')
  await tick(300)                     // the same map again: no second reload
  expect(systemsCalls).toBe(before + 1)
})

it('a star that never turns up asks for one reload per new map, not one per poll', async () => {
  const before = systemsCalls
  map = { ...map, dormant: [...map.dormant, { id: 'ghost', name: 'Ghost' }] }
  await tick(900)
  expect(systemsCalls).toBe(before + 1)
  expect(wormholeMapParts().labels).not.toContain('Ghost')
})

it("an open wormhole to the galaxy's centre star draws its label without a zero-length beam", async () => {
  map = { ...map, events: [{ ...scheduled, id: 'e0', target: { id: 'o', name: 'Star o' }, status: 'open', exclusive: false }] }
  await tick(300)
  const parts = wormholeMapParts()
  expect(parts.labels).toContain('WORMHOLE · until 15:00 UTC')
  expect(parts.beam).toBe(1)          // just a ⇄ b: the centre beam was skipped, not NaN
})

it('the open wormhole pulses, a few material writes a second', async () => {
  map = { ...map, events: [{ ...scheduled, id: 'e2', status: 'open', exclusive: false }] }
  await tick(300)
  expect(wormholeMapParts().beam).toBe(2)
  const materials = vi.spyOn(Material, 'setPbrMaterial')
  await tick(10)
  expect(materials.mock.calls.length).toBeGreaterThan(0)
  expect(materials.mock.calls.length).toBeLessThanOrEqual(10 * 10 + 1)
  vi.restoreAllMocks()
})

it('a 403 (no longer owned) clears the overlay and stops polling', async () => {
  reply = async () => null
  await tick(300)
  const calls = mapCalls
  const parts = wormholeMapParts()
  expect(parts.beam + parts.dash + parts.ring + parts.cap + parts.label).toBe(0)
  await tick(900)
  expect(mapCalls).toBe(calls)
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/wormholeMap.test.ts`
Expected: FAIL, because it can't resolve `../src/observation/wormholeMap`.

- [ ] **Step 3: Write the overlay**

`src/observation/wormholeMap.ts`:

```ts
// The Eld's wormhole map on the galaxy hologram (galaxyHologram.ts), for players who bought it at the Eld's relay
// (blackMarket/): every known wormhole in their galaxy and where it leads. Linked black holes are joined by a violet
// beam; a black hole not linked yet wears a broken ring; a timed wormhole is a beam from the galaxy's heart to its
// target, bright and pulsing while open (gold when the Eld built it), dashed while scheduled, with a red diamond over
// a private one. The hologram's stars can't be pointed at, so names hang under them (the heat map's counts sit above).
// Each visitor draws the hologram for themselves: only owners see this.
//
// The server builds the map fresh (GET /api/black-market/wormhole-map; 403 when not owned). It's fetched once aboard
// and every 5 minutes after, one request at a time, and redrawn only when it changed. A wormhole star the hologram
// hasn't got (found since it loaded its stars) has it reload them, once per new map.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, TextShape, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { getMarketMine, getWormholeMap, type WormholeMap } from '../stationApi'
import { starEntities, getGalaxyRoot, addMapRenderHooks } from '../galaxyMap'
import { onGateChanged } from '../gate'

const POLL_SECONDS = 300
const OWNERSHIP_RETRY_SECONDS = 60 // a failed ownership check, tried again
const PULSE_STEP = 0.1 // the open wormhole's beam: ten material writes a second at most
const BEAM = 0.012 // beam radius, in the map's units (its stars are 0.05–0.15 across)
const DASH = 0.12 // a scheduled wormhole's dash, and the gap after it
const MAX_DASHES = 60
const RING = 0.13 // a dormant black hole's ring
const LABEL_DROP = 0.16 // names hang under the star
const VIOLET = Color3.create(0.62, 0.4, 1)
const DIM_VIOLET = Color3.create(0.42, 0.3, 0.7)
const GOLD = Color3.create(1, 0.78, 0.3) // an open or scheduled wormhole the Eld built
const ICE = Color3.create(0.55, 0.85, 1) // one an admin made
const LOCK = Color3.create(1, 0.35, 0.45) // a private wormhole's diamond

export type Part = 'beam' | 'dash' | 'ring' | 'cap' | 'label'

let owned = false
let aboard = false
let ownership: 'unchecked' | 'checking' | 'checked' = 'unchecked'
let sinceOwnershipCheck = 0
let map: WormholeMap | null = null
let mapKey = '' // the last map fetched, as JSON
let drawnKey = '' // the map on the hologram ('' = nothing drawn)
let parts: { entity: Entity; part: Part }[] = []
let openBeam: { entity: Entity; color: Color3 } | null = null
let inFlight = false
let sincePoll = 0
let pulseTimer = 0
let t = 0
let reloadStars: (() => Promise<void>) | null = null
let reloadedFor = '' // the map key the stars were last reloaded for

const hhmm = (iso: string) => `${new Date(iso).toISOString().slice(11, 16)} UTC`
const look = (c: Color3, glow: number, alpha: number) => ({
  albedoColor: Color4.create(c.r, c.g, c.b, alpha),
  emissiveColor: c,
  emissiveIntensity: glow,
  transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  castShadows: false
})

export function setupWormholeMap(reload: () => Promise<void>): void {
  reloadStars = reload
  addMapRenderHooks({ rendered: draw, cleared: clear })
  engine.addSystem(wormholeMapSystem)
  onGateChanged((gate) => {
    aboard = gate.kind === 'aboard'
    if (aboard && ownership === 'unchecked') checkOwnership()
  })
}

/** Does the player own the map? A failed check is tried again a minute later (wormholeMapSystem). */
function checkOwnership(): void {
  ownership = 'checking'
  sinceOwnershipCheck = 0
  getMarketMine()
    .then((mine) => {
      ownership = 'checked'
      if (mine.wormholeMap) wormholeMapOwned()
    })
    .catch(() => { ownership = 'unchecked' })
}

/** The player owns the map (just bought it, or it's on record): show it now and keep it current. */
export function wormholeMapOwned(): void {
  if (owned) return
  owned = true
  void poll()
}

/** What's drawn, by kind, and the labels' text (for tests). */
export function wormholeMapParts(): Record<Part, number> & { labels: string[]; entities: Entity[] } {
  const count: Record<Part, number> = { beam: 0, dash: 0, ring: 0, cap: 0, label: 0 }
  for (const p of parts) count[p.part]++
  const labels = parts.filter((p) => p.part === 'label').map((p) => TextShape.get(p.entity).text)
  return { ...count, labels, entities: parts.map((p) => p.entity) }
}

async function poll(): Promise<void> {
  if (inFlight || !owned) return
  inFlight = true
  sincePoll = 0
  try {
    const next = await getWormholeMap()
    if (next === null) {
      // Not owned (any more): an admin took it back
      owned = false
      map = null
      mapKey = ''
      clear()
      return
    }
    const key = JSON.stringify(next)
    if (key === mapKey) return
    map = next
    mapKey = key
    draw()
  } catch {
    /* keep what's drawn */
  } finally {
    inFlight = false
  }
}

function clear(): void {
  for (const p of parts) engine.removeEntity(p.entity)
  parts = []
  openBeam = null
  drawnKey = ''
}

function wanted(m: WormholeMap): string[] {
  return [...m.links.flatMap((l) => [l.a.id, l.b.id]), ...m.dormant.map((d) => d.id), ...m.events.map((e) => e.target.id)]
}

function draw(): void {
  if (!map || drawnKey === mapKey) return
  const at = new Map<string, Vector3>()
  for (const [star, system] of starEntities) at.set(system.id, Transform.get(star).position)
  if (at.size === 0) return // the hologram hasn't drawn its stars yet; its render hook calls back
  if (reloadStars && reloadedFor !== mapKey && wanted(map).some((id) => !at.has(id))) {
    reloadedFor = mapKey
    void reloadStars().catch(() => {}) // redraws through the render hook; meanwhile, draw what we can
  }
  clear()
  const root = getGalaxyRoot()
  const centre = Vector3.Zero()

  for (const link of map.links) {
    const a = at.get(link.a.id)
    const b = at.get(link.b.id)
    if (!a || !b) continue
    segment(root, a, b, VIOLET, 2.5, 0.6, 'beam')
    label(root, a, link.a.name, VIOLET)
    label(root, b, link.b.name, VIOLET)
  }
  for (const hole of map.dormant) {
    const p = at.get(hole.id)
    if (!p) continue
    ring(root, p)
    label(root, p, hole.name, DIM_VIOLET)
  }
  for (const ev of map.events) {
    const p = at.get(ev.target.id)
    if (!p) continue
    const colour = ev.eldBuilt ? GOLD : ICE
    if (ev.status === 'open') {
      const beam = segment(root, centre, p, colour, 4, 0.7, 'beam')
      if (beam) openBeam = { entity: beam, color: colour }
    } else {
      dashes(root, centre, p, colour)
    }
    if (ev.exclusive) cap(root, p)
    label(root, p, ev.status === 'open' ? `WORMHOLE · until ${hhmm(ev.endsAt)}` : `WORMHOLE · opens ${hhmm(ev.startsAt)}`, colour, LABEL_DROP * 2)
  }
  drawnKey = mapKey
}

/** A thin glowing cylinder from `from` to `to` (none when they coincide). */
function segment(root: Entity, from: Vector3, to: Vector3, colour: Color3, glow: number, alpha: number, part: Part): Entity | null {
  const d = Vector3.subtract(to, from)
  const length = Vector3.length(d)
  if (length < 1e-4) return null
  const e = engine.addEntity()
  Transform.create(e, {
    parent: root,
    position: Vector3.lerp(from, to, 0.5),
    rotation: Quaternion.fromToRotation(Vector3.Up(), Vector3.normalize(d)),
    scale: Vector3.create(BEAM * 2, length, BEAM * 2)
  })
  MeshRenderer.setCylinder(e)
  Material.setPbrMaterial(e, look(colour, glow, alpha))
  parts.push({ entity: e, part })
  return e
}

function dashes(root: Entity, from: Vector3, to: Vector3, colour: Color3): void {
  const length = Vector3.distance(from, to)
  const n = Math.min(MAX_DASHES, Math.floor(length / (DASH * 2)))
  for (let i = 0; i < n; i++) {
    const a = Vector3.lerp(from, to, (i * 2 * DASH) / length)
    const b = Vector3.lerp(from, to, ((i * 2 + 1) * DASH) / length)
    segment(root, a, b, colour, 1.5, 0.35, 'dash')
  }
}

/** Four short arcs round a dormant black hole, flat in the galaxy's plane. */
function ring(root: Entity, p: Vector3): void {
  const at = (deg: number) => {
    const r = (deg * Math.PI) / 180
    return Vector3.create(p.x + Math.cos(r) * RING, p.y, p.z + Math.sin(r) * RING)
  }
  for (const mid of [45, 135, 225, 315]) segment(root, at(mid - 25), at(mid + 25), DIM_VIOLET, 1, 0.5, 'ring')
}

/** A small red diamond over a private wormhole's target. */
function cap(root: Entity, p: Vector3): void {
  const e = engine.addEntity()
  Transform.create(e, {
    parent: root,
    position: Vector3.create(p.x, p.y + 0.14, p.z),
    rotation: Quaternion.fromEulerDegrees(45, 0, 45),
    scale: Vector3.create(0.05, 0.05, 0.05)
  })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, look(LOCK, 3, 1))
  parts.push({ entity: e, part: 'cap' })
}

function label(root: Entity, p: Vector3, text: string, colour: Color3, drop = LABEL_DROP): void {
  const e = engine.addEntity()
  Transform.create(e, { parent: root, position: Vector3.create(p.x, p.y - drop, p.z) })
  TextShape.create(e, { text, fontSize: 1.4, textColor: Color4.create(colour.r, colour.g, colour.b, 1), outlineWidth: 0.15, outlineColor: Color3.Black() })
  Billboard.create(e, { billboardMode: BillboardMode.BM_Y })
  parts.push({ entity: e, part: 'label' })
}

function wormholeMapSystem(dt: number): void {
  if (!owned) {
    if (aboard && ownership === 'unchecked') {
      sinceOwnershipCheck += dt
      if (sinceOwnershipCheck >= OWNERSHIP_RETRY_SECONDS) checkOwnership()
    }
    return
  }
  sincePoll += dt
  if (sincePoll >= POLL_SECONDS) void poll()
  if (!openBeam) return
  t += dt
  pulseTimer -= dt
  if (pulseTimer > 0) return
  pulseTimer = PULSE_STEP
  const k = 0.5 + 0.5 * Math.sin(t * 3)
  Material.setPbrMaterial(openBeam.entity, look(openBeam.color, 3 + k * 4, 0.5 + 0.4 * k))
}
```

- [ ] **Step 4: Give the hologram `reloadStars` and set up the overlay**

In `src/observation/galaxyHologram.ts`:

Change the `galaxyMap` import to add `clearMap`, and add the overlay import:

```ts
import { getGalaxyRoot, renderStarSystems, galaxyAnimationSystem, setMapView, clearMap } from '../galaxyMap'
import { setupWormholeMap } from './wormholeMap'
```

Inside `buildGalaxyHologram()`, replace the `let shown = false … })` block at the end with:

```ts
  // The stars, again: when the Eld's wormhole map names one found since they loaded (wormholeMap.ts)
  async function reloadStars(): Promise<void> {
    const me = await api.getPlayerMe()
    const systems = await api.getSystems(me.galaxy_id)
    clearMap()
    Transform.getMutable(getGalaxyRoot()).parent = inner
    renderStarSystems(systems, me.home_system_id, me.current_system_id)
  }
  setupWormholeMap(reloadStars)

  let shown = false
  onGateChanged((gate) => {
    if (gate.kind !== 'aboard' || shown) return
    shown = true
    void (async () => {
      try {
        const me = await api.getPlayerMe()
        const systems = await api.getSystems(me.galaxy_id)
        Transform.getMutable(getGalaxyRoot()).parent = inner
        setMapView({ scale: MAP_SCALE })
        setPref('heatMap', true) // for this session only: the station saves just its own settings (prefs.ts)
        setupHeatMap(me.galaxy_id)
        renderStarSystems(systems, me.home_system_id, me.current_system_id)
      } catch (err) {
        shown = false
        console.log('[galaxy hologram] galaxy map failed', err)
      }
    })()
  })
```

Add to the file's header comment, after the heat-map sentence: `Owners of the Eld's wormhole map also see every known wormhole on it (wormholeMap.ts).`

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/wormholeMap.test.ts`
Expected: PASS (7 tests). If `buildGalaxyHologram` fails in Node because of something not mocked (for example `setupHeatMap`'s fetch), add that function to the `../src/api` mock. Don't change the code under test.

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: all PASS. `test/holograms.test.ts` still passes, because `galaxyMap.ts` is untouched.

- [ ] **Step 7: Commit**

```bash
git add src/observation/wormholeMap.ts src/observation/galaxyHologram.ts test/wormholeMap.test.ts
git commit -m "Wormhole map: every known wormhole on the galaxy hologram, for owners"
```

### Task 3: Buying it at the Eld's relay

**Files:**
- Modify: `src/blackMarket/market.ts` (`market` state, `refreshMine`, `settle`)
- Modify: `src/blackMarket/panelUi.tsx` (`Actions`)
- Test: `test/wormholeMapBuy.test.ts`

**Interfaces:**
- Consumes: `wormholeMapOwned()`, `wormholeMapParts()` (Task 2); `getMarketMine().wormholeMap` (Task 1).
- Produces: `market.ownsMap: boolean`.

- [ ] **Step 1: Write the failing test**

`test/wormholeMapBuy.test.ts`:

```ts
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
  await tick(600)
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
  expect(market.ownsMap).toBe(true)
  expect(market.mine).toContain('Wormhole map')
})

it('never has two map requests in flight, however slow the server is', async () => {
  reply = () => new Promise(() => {})
  const calls = mapCalls
  await tick(900)                    // three polls would be due
  expect(mapCalls).toBe(calls + 1)   // one, still waiting
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/wormholeMapBuy.test.ts`
Expected: FAIL on `market.ownsMap` being `undefined` and on `mapCalls` staying 0 after the purchase.

- [ ] **Step 3: Teach the market about the map**

In `src/blackMarket/market.ts`:

Add the import:

```ts
import { wormholeMapOwned } from '../observation/wormholeMap'
```

Add to the `market` object, after `mine: ''`:

```ts
  mine: '', // "Cloaked until 14:20 · 1 insurance policy · Wormhole map"
  /** the player owns the Eld's wormhole map (it can't be petitioned for again) */
  ownsMap: false
```

(Replace the existing `mine: '' // …` line with the two lines above, keeping one `mine` key.)

In `refreshMine`, after the insurance line:

```ts
    if (mine.wormholeMap) bits.push('Wormhole map')
    market.ownsMap = !!mine.wormholeMap
    if (mine.wormholeMap) wormholeMapOwned()
```

In `settle`, inside `if (r.status === 'ok') { … }`, before `void refreshMine()`:

```ts
        if (market.items.find((i) => i.id === itemId)?.kind === 'map') {
          market.ownsMap = true
          wormholeMapOwned()
        }
```

- [ ] **Step 4: Show OWNED in the panel**

In `src/blackMarket/panelUi.tsx`, in `Actions`, replace the `PETITION` line with:

```tsx
      {phase === 'browse' && item.kind === 'map' && market.ownsMap && <Button label="ALREADY YOURS" enabled={false} onClick={() => {}} />}
      {phase === 'browse' && !(item.kind === 'map' && market.ownsMap) && <Button label="PETITION" primary enabled={!market.busy} onClick={() => void askQuote()} />}
```

And in `market.ts` `askQuote`, after `if (!item || market.busy) return`:

```ts
  if (item.kind === 'map' && market.ownsMap) return
```

- [ ] **Step 5: Add the "owned stops a second petition" assertion**

Append to the second test in `test/wormholeMapBuy.test.ts`, after `expect(market.mine).toContain('Wormhole map')`:

```ts
  const { quoteMarket } = await import('../src/stationApi')
  const quotes = (quoteMarket as any).mock.calls.length
  selectItem(market.items[0])
  await askQuote()
  expect((quoteMarket as any).mock.calls.length).toBe(quotes)   // no second petition sent
  expect(market.phase).toBe('browse')
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run`
Expected: all PASS, including `wormholeMapBuy.test.ts` (3) and `wormholeMap.test.ts` (7).

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: "Type checking completed without errors".

- [ ] **Step 8: Commit**

```bash
git add src/blackMarket/market.ts src/blackMarket/panelUi.tsx test/wormholeMapBuy.test.ts
git commit -m "Wormhole map: buy it from the Eld; it appears at once and can't be bought twice"
```

### Task 4: Check it for real, hand off, deploy, put it on sale (each step needs the user's go-ahead)

**Files:**
- Modify: `HANDOFF.md`
- Modify (server repo): `src/services/blackMarket/rules.ts`, `src/services/blackMarket/__tests__/rules.test.ts`, `src/routes/__tests__/blackMarket.test.ts`

- [ ] **Step 1: Preview against staging.** With the server plan on staging and the user's player granted a map (server plan Task 6), run `npm start` pointed at staging (the usual way this scene previews against staging). Board, look at the hologram, and confirm with the user: the pairs, the dormant rings, the labels, and any timed wormhole.
- [ ] **Step 2: Update `HANDOFF.md`.** Add the wormhole map to the Eld relay's description, `test/wormholeMap*.test.ts` to the tests list, and the rule "the overlay polls every 5 min, owners only". Commit: `HANDOFF: the Eld's wormhole map`.
- [ ] **Step 3: Deploy the scene** (user's go-ahead; they sign). `npm run deploy -- --target-content https://worlds-content-server.decentraland.org`. Record it in HANDOFF's "Last deployed" line and commit.
- [ ] **Step 4: Put the item on sale (server repo, user's go-ahead).** In `rules.ts`, remove `offSale: true` and the "Off sale until…" comment from `wormhole_map`. In `rules.test.ts`, change the off-sale test to:

```ts
  it('sells the wormhole map', () => {
    expect(itemById('wormhole_map')).toMatchObject({ kind: 'map', mana: 60 });
  });
```

In `src/routes/__tests__/blackMarket.test.ts`, change `toHaveLength(10)` to `toHaveLength(11)`. Run `npx vitest run`, commit `Wormhole map: on sale`, and deploy the server as usual (production: push to `main`).

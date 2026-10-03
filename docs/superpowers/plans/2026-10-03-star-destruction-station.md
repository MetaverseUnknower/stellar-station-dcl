# Star Destruction on Sale (station) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The hub's galaxy hologram draws supernova remnants small and dead, black holes are never offered for destruction, and the buyer sees their destruction at once. Then star destruction goes on sale.

**Architecture:** The remnant look goes into the shared ship copy `src/galaxyMap.ts` (`renderStarSystems`), so the ship follow-on can copy the file whole. A tiny `src/observation/starReload.ts` hook lets the market ask the hologram to reload its stars without importing it. `src/blackMarket/market.ts` filters black holes out of the destroy picker, and after a destroy purchase it drops the star and triggers the reload.

**Tech Stack:** Decentraland SDK 7.23.2 (ECS), TypeScript, vitest running the real engine headless (`test/helpers.ts`), Node 20.

**Spec:** `docs/superpowers/specs/2026-10-02-star-destruction-design.md` (section "2. This station")

**Depends on:** the server plan (`galaxy-gardeners-server/docs/superpowers/plans/2026-10-03-star-destruction-server.md`) for the refusal and the empty remnant detail. Tasks 1–2 need only mocks. Task 3 (going on sale) needs both shipped.

## Global Constraints

- Remnant ember: the star's own sphere, size `0.025`, albedo `Color4.create(0.35, 0.05, 0.03, 1)`, emissive `Color3.create(0.5, 0.08, 0.04)`, intensity `1.2`.
- Remnant shell: a sphere `0.045` across, albedo `Color4.create(0.8, 0.25, 0.15, 0.1)`, emissive the same RGB at intensity `0.3`, alpha blend, no shadows, no collider.
- A remnant gets no label, no home pin, no station halo and no current-location marker.
- A remnant's whole footprint stays under a plain star (`0.05`).
- Nothing about remnants is written per frame.
- Black holes (`has_wormhole`) are never offered for `destroy`. Other items still list them.
- HANDOFF "Scene tests": per-frame systems never re-set materials, meshes or text every frame; fresh module state = its own test file; no `vi.resetModules`. Long `tick()` waits run at low fps (e.g. `tick(300, 2)`).

## Review Focus

- **A black hole picked under another item before switching to destroy.** `market.star` must not stay a black hole.
  Test in Task 2.
- **A remnant that is also somebody's home or current system** (stale data). It still renders as a remnant, with no
  pin or marker. Test in Task 1.
- **The systems list from an older server without `remnant_at`.** Stars render normally. Test in Task 1 (a system
  with no `remnant_at` key at all).
- **A destroy purchase that completes while the hologram hasn't drawn its stars yet** (no reloader registered).
  `reloadGalaxyStars()` must be a harmless no-op. Test in Task 2 by calling it before any reloader is set.
- **A cloak (or any non-destroy) purchase** must not reload 1,000 stars. Test in Task 2.

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/types.ts` | modify | `StarSystem.remnant_at?` |
| `src/galaxyMap.ts` | modify | remnant ember and shell in `renderStarSystems` |
| `test/remnants.test.ts` | create | how remnants render |
| `src/observation/starReload.ts` | create | `setStarReloader`, `reloadGalaxyStars` |
| `src/observation/galaxyHologram.ts` | modify | registers its `reloadStars` |
| `src/blackMarket/market.ts` | modify | the destroy picker without black holes; after a destroy, drop the star and reload |
| `test/remnantBuy.test.ts` | create | the picker and the purchase |
| `HANDOFF.md` | modify | remnants, the new tests |

---

### Task 1: Remnants on the hologram

**Files:**
- Modify: `src/types.ts` (`StarSystem`)
- Modify: `src/galaxyMap.ts` (`renderStarSystems`, ~line 523; new helper beside `addStationRing`)
- Test: `test/remnants.test.ts`

**Interfaces:**
- Produces: `StarSystem.remnant_at?: string | null`. In `renderStarSystems`, a remnant's sphere is still registered in `starEntities` (so overlays can find it).

- [ ] **Step 1: Write the failing test**

`test/remnants.test.ts`:

```ts
// A supernova remnant (destroyed at the Eld's black market) on the galaxy map: a small dark-red ember in a faint
// shell, smaller than any live star to de-crowd the map, with no label or markers, and nothing written per frame.
import { it, expect, vi } from 'vitest'
import { engine, Transform, MeshRenderer, Material, TextShape, MeshCollider } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

vi.mock('../src/api', async (orig) => ({ ...(await orig<any>()) }))

import { renderStarSystems, starEntities, galaxyAnimationSystem, getGalaxyRoot } from '../src/galaxyMap'

const sys = (id: string, x: number, extra: any = {}) => ({
  id, name: `Star ${id}`, coord_r: 0, coord_theta: 0, coord_x: x, coord_y: x / 3, coord_z: 0, origin: false,
  discovered_by: null, discovered_by_name: null, has_station: false, solar_recharge_rate: 1, has_wormhole: false,
  star_type: null, created_at: '', ...extra
})
const DEAD = '2026-10-01T00:00:00Z'

// 'r' is a remnant that stale data also calls home and current; 'old' comes from a server without remnant_at at all
const systems: any[] = [sys('live', 10, { remnant_at: null }), sys('r', -10, { remnant_at: DEAD }), sys('old', 5)]
delete systems[2].remnant_at
renderStarSystems(systems, 'r', 'r')

const entityOf = (id: string) => [...starEntities].find(([, s]) => s.id === id)![0]
const near = (a: Vector3, b: Vector3) => Vector3.distance(a, b) < 1e-6
const root = getGalaxyRoot()
/** Every rendered thing under the map's root sitting at a star's position. */
const at = (id: string) => {
  const p = Transform.get(entityOf(id)).position
  return [...engine.getEntitiesWith(Transform)].filter(([e, t]) => t.parent === root && near(t.position, p)).map(([e]) => e)
}

it('draws a remnant as a small dark-red ember inside a faint shell, both smaller than a plain star', () => {
  const ember = entityOf('r')
  expect(Transform.get(ember).scale.x).toBeCloseTo(0.025)
  expect((Material.get(ember) as any).material.$case).toBe('pbr')
  const things = at('r')
  expect(things).toHaveLength(2)                                  // the ember and its shell, nothing else
  const shell = things.find((e) => e !== ember)!
  expect(Transform.get(shell).scale.x).toBeCloseTo(0.045)
  expect(Transform.get(shell).scale.x).toBeLessThan(0.05)         // the whole footprint under a plain star
  expect(MeshRenderer.has(shell)).toBe(true)
  expect(MeshCollider.has(shell)).toBe(false)
})

it('gives a remnant no label, pin or marker, even when stale data calls it home and current', () => {
  const p = Transform.get(entityOf('r')).position
  const textsNear = [...engine.getEntitiesWith(Transform, TextShape)].filter(([, t]) => Vector3.distance(t.position, p) < 0.5)
  expect(textsNear).toEqual([])
  expect(at('r')).toHaveLength(2)                                 // nothing else at the star itself
  const pinsAbove = [...engine.getEntitiesWith(Transform)].filter(([, t]) => t.parent === root && Math.abs(t.position.x - p.x) < 1e-6 && Math.abs(t.position.z - p.z) < 1e-6 && t.position.y > p.y)
  expect(pinsAbove).toEqual([])
})

it('leaves live stars as they were, including systems from an older server', () => {
  expect(Transform.get(entityOf('live')).scale.x).toBeCloseTo(0.05)
  expect(Transform.get(entityOf('old')).scale.x).toBeCloseTo(0.05)
})

it('writes nothing for a remnant frame by frame', () => {
  const mine = new Set(at('r'))
  const materials = vi.spyOn(Material, 'setPbrMaterial')
  for (let i = 0; i < 600; i++) galaxyAnimationSystem(1 / 60)
  expect(materials.mock.calls.filter((c) => mine.has(c[0]))).toEqual([])
  vi.restoreAllMocks()
})
```

(The home pin and the current-location marker are both parented to the map's root, directly above the star
— `galaxyMap.ts` `addHomePin`, `createCurrentLocationMarker` — so `pinsAbove` catches either.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 20 && npx vitest run test/remnants.test.ts`
Expected: FAIL. The ember is 0.12 (`r` is home), there's no shell, and there is a pin and a marker.

- [ ] **Step 3: Add `remnant_at` to the type**

In `src/types.ts` `StarSystem`, after `has_wormhole: boolean`:

```ts
  /** Destroyed at the Eld's black market (a supernova remnant); missing from older servers */
  remnant_at?: string | null
```

- [ ] **Step 4: Draw remnants in `galaxyMap.ts`**

Near `HOME_COLOR` / `STATION_COLOR`, add:

```ts
// A supernova remnant (a star destroyed at the station's black market): a small dark-red ember in a faint shell,
// smaller than any live star (0.05) so dead regions of the galaxy thin out; no label, pin or marker.
const REMNANT_EMBER = { color: Color4.create(0.35, 0.05, 0.03, 1), emissive: Color3.create(0.5, 0.08, 0.04), size: 0.025, intensity: 1.2 }
const REMNANT_SHELL_SIZE = 0.045
const REMNANT_SHELL_COLOR = Color3.create(0.8, 0.25, 0.15)
```

Beside `addStationRing`, add:

```ts
/** The faint cloud a supernova leaves round its ember. */
function addRemnantShell(root: Entity, pos: Vector3): void {
  const shell = engine.addEntity()
  Transform.create(shell, { position: pos, scale: Vector3.create(REMNANT_SHELL_SIZE, REMNANT_SHELL_SIZE, REMNANT_SHELL_SIZE), parent: root })
  MeshRenderer.setSphere(shell)
  const c = REMNANT_SHELL_COLOR
  Material.setPbrMaterial(shell, { albedoColor: Color4.create(c.r, c.g, c.b, 0.1), emissiveColor: c, emissiveIntensity: 0.3, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false })
  nebulaEntities.push(shell)   // cleared with the map
}
```

In `renderStarSystems`, replace the loop body's first line and the marker lines so it reads:

```ts
  for (const system of systems) {
    const remnant = !!system.remnant_at
    const { color, emissive, size, intensity } = remnant ? REMNANT_EMBER : getStarColor(system, homeSystemId, currentSystemId)
    const entity = engine.addEntity()
    const position = Vector3.create(system.coord_x * scale, system.coord_z * scale, system.coord_y * scale)
    Transform.create(entity, { position, scale: Vector3.create(size, size, size), parent: root })
    MeshRenderer.setSphere(entity)
    MeshCollider.setSphere(entity, ColliderLayer.CL_POINTER)
    Material.setPbrMaterial(entity, { albedoColor: color, emissiveColor: emissive, emissiveIntensity: intensity })
    starEntities.set(entity, system)
    if (remnant) {
      addRemnantShell(root, position)
      continue // a dead star wears no markers
    }
    if (system.id === currentSystemId) createCurrentLocationMarker(position)
    // Shape cues so no marker relies on colour alone: a pin over home, a flat halo disc around stations.
    if (system.id === homeSystemId) addHomePin(root, position, size)
    if (system.has_station) addStationRing(root, position, size)
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run` (all files; `holograms.test.ts` must still pass). Then `npm run build`, which must end "Type checking completed without errors".

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/galaxyMap.ts test/remnants.test.ts
git commit -m "Star destruction: remnants on the galaxy map, small and dead"
```

### Task 2: The picker and the purchase

**Files:**
- Create: `src/observation/starReload.ts`
- Modify: `src/observation/galaxyHologram.ts` (register `reloadStars`)
- Modify: `src/blackMarket/market.ts` (`starMatches`, `selectItem`, `settle`)
- Test: `test/remnantBuy.test.ts`

**Interfaces:**
- Consumes: `reloadStars` inside `buildGalaxyHologram` (exists; it re-fetches systems and re-renders).
- Produces:
  ```ts
  // src/observation/starReload.ts
  export function setStarReloader(fn: () => Promise<void>): void
  export function reloadGalaxyStars(): void   // no-op until a reloader is set; never throws
  ```

- [ ] **Step 1: Write the failing test**

`test/remnantBuy.test.ts`:

```ts
// Star destruction at the Eld's relay: black holes are never offered; destroying a star drops it from the picker and
// has the galaxy hologram reload its stars once (so the buyer sees the remnant); other purchases reload nothing.
import { it, expect, vi } from 'vitest'
import { tick } from './helpers'

const sys = (id: string, x: number, extra: any = {}) => ({
  id, name: `Star ${id}`, coord_r: 0, coord_theta: 0, coord_x: x, coord_y: 0, coord_z: 0, origin: false,
  discovered_by: null, discovered_by_name: null, has_station: false, solar_recharge_rate: 1, has_wormhole: false,
  star_type: null, created_at: '', remnant_at: null, ...extra
})
let systemsCalls = 0
const ITEMS = [
  { id: 'star_destruction', name: 'Star destruction', mana: 150, blurb: '', kind: 'destroy', hours: null, exclusive: false },
  { id: 'wormhole_public_1h', name: 'Open wormhole (1 h)', mana: 50, blurb: '', kind: 'wormhole', hours: 1, exclusive: false },
  { id: 'cloak', name: 'Cloaking device', mana: 25, blurb: '', kind: 'cloak', hours: 24, exclusive: false },
]

vi.mock('../src/auth', () => ({ authenticate: vi.fn(async () => ({ hasPlayer: true })), getToken: () => 'token' }))
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getPlayerMe: vi.fn(async () => ({ id: 'p1', galaxy_id: 'g1', home_system_id: null, current_system_id: null })),
  getSystems: vi.fn(async () => { systemsCalls++; return [sys('plain', 10), sys('maw', -10, { has_wormhole: true })] }),
  getSystemPopulation: vi.fn(async () => ({ windowHours: 24, systems: [] })),
}))
vi.mock('../src/fuel/payments', async (orig) => ({ ...(await orig<any>()), payMana: vi.fn(async () => '0x' + 'cd'.repeat(32)) }))
vi.mock('../src/stationApi', async (orig) => ({
  ...(await orig<any>()),
  getStationStatus: vi.fn(async () => ({ isDocked: true, stationId: 'st1', isAdmin: false })),
  listStations: vi.fn(async () => []),
  getMarketMine: vi.fn(async () => ({ cloakedUntil: null, insurancePolicies: 0, wormholeMap: false })),
  getMarketCatalog: vi.fn(async () => ({ items: ITEMS })),
  getMarketPending: vi.fn(async () => ({ pending: [] })),
  getFriends: vi.fn(async () => ({ friends: [], incomingRequests: [], outgoingRequests: [] })),
  quoteMarket: vi.fn(async () => ({ summary: 'It goes supernova.', mana: 150 })),
  buyFromMarket: vi.fn(async () => ({ status: 'ok', summary: 'Done.' })),
  getWormholeMap: vi.fn(async () => null),
}))

import { reloadGalaxyStars } from '../src/observation/starReload'
import { startGate } from '../src/gate'
import { buildGalaxyHologram } from '../src/observation/galaxyHologram'
import { market, openMarket, selectItem, askQuote, pay, again, starMatches, pickStar } from '../src/blackMarket/market'

const item = (id: string) => market.items.find((i) => i.id === id)!
const ids = () => starMatches().map((s) => s.id)

it('asking for a star reload before the hologram exists does nothing', () => {
  expect(() => reloadGalaxyStars()).not.toThrow()
  expect(systemsCalls).toBe(0)
})

it('never offers a black hole for destruction, but still does for a wormhole', async () => {
  buildGalaxyHologram()
  await startGate()
  await tick(2, 2)
  await openMarket()
  selectItem(item('star_destruction'))
  market.starQuery = 'Star'
  expect(ids()).toEqual(['plain'])
  selectItem(item('wormhole_public_1h'))
  market.starQuery = 'Star'
  expect(ids().sort()).toEqual(['maw', 'plain'])
})

it('forgets a black hole picked for a wormhole when switching to destruction', () => {
  selectItem(item('wormhole_public_1h'))
  pickStar(market.stars.find((s) => s.id === 'maw')!)
  selectItem(item('star_destruction'))
  expect(market.star).toBeNull()
})

it('destroying a star drops it from the picker and reloads the hologram once', async () => {
  selectItem(item('star_destruction'))
  pickStar(market.stars.find((s) => s.id === 'plain')!)
  await askQuote()
  const before = systemsCalls
  await pay()
  await tick(1, 2)
  expect(market.phase).toBe('done')
  expect(systemsCalls).toBe(before + 1)
  expect(market.stars.map((s) => s.id)).not.toContain('plain')
  expect(market.star).toBeNull()
})

it('any other purchase reloads nothing', async () => {
  again()
  selectItem(item('cloak'))
  await askQuote()
  const before = systemsCalls
  await pay()
  await tick(1, 2)
  expect(market.phase).toBe('done')
  expect(systemsCalls).toBe(before)
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/remnantBuy.test.ts`
Expected: FAIL, because it can't resolve `../src/observation/starReload`.

- [ ] **Step 3: The reload hook**

`src/observation/starReload.ts`:

```ts
// One way for anything in the scene to ask the galaxy hologram (galaxyHologram.ts) to reload its stars, without
// importing it: after a star is destroyed at the Eld's relay, so the buyer sees the remnant at once.
let reloader: (() => Promise<void>) | null = null

export function setStarReloader(fn: () => Promise<void>): void {
  reloader = fn
}

/** Reload the hologram's stars, if it has drawn them yet. Never throws. */
export function reloadGalaxyStars(): void {
  if (!reloader) return
  void reloader().catch((err) => console.log('[galaxy hologram] star reload failed', err))
}
```

- [ ] **Step 4: Register the hologram's reload**

In `src/observation/galaxyHologram.ts`, add the import `import { setStarReloader } from './starReload'`, and on the
line after `setupWormholeMap(reloadStars)` add `setStarReloader(reloadStars)`.

- [ ] **Step 5: The picker and the purchase in `market.ts`**

Add the import `import { reloadGalaxyStars } from '../observation/starReload'`.

Replace `starMatches`:

```ts
/** Stars matching the search. Black holes are never offered for destruction (the Eld won't touch them). */
export function starMatches(): StarSystem[] {
  const q = market.starQuery.trim().toLowerCase()
  if (!q) return []
  const destroying = market.selected?.kind === 'destroy'
  return market.stars.filter((s) => !(destroying && s.has_wormhole) && s.name.toLowerCase().includes(q)).slice(0, STAR_RESULTS)
}
```

In `selectItem`, after the `market.guests = []` line, add:

```ts
  if (item.kind === 'destroy' && market.star?.has_wormhole) market.star = null
```

In `settle`, replace the `if (market.items.find((i) => i.id === itemId)?.kind === 'map') { … }` block with:

```ts
        const kind = market.items.find((i) => i.id === itemId)?.kind
        if (kind === 'map') {
          market.ownsMap = true
          wormholeMapOwned()
        }
        if (kind === 'destroy') {
          // Gone: off the picker at once, and the buyer's hologram redraws it as a remnant
          market.stars = market.stars.filter((s) => s.id !== sent.systemId)
          if (market.star?.id === sent.systemId) market.star = null
          reloadGalaxyStars()
        }
```

(`sent` is `settle`'s `MarketParams` argument; `systemId` is what `params()` sends for `destroy`.)

- [ ] **Step 6: Run the tests**

Run: `npx vitest run` and `npm run build`. Expected: all pass, and the type check is clean.

- [ ] **Step 7: Commit**

```bash
git add src/observation/starReload.ts src/observation/galaxyHologram.ts src/blackMarket/market.ts test/remnantBuy.test.ts
git commit -m "Star destruction: no black holes in the picker; the buyer's hologram shows the remnant at once"
```

### Task 3: Hand off, deploy, put it on sale (each step needs the user's go-ahead)

- [ ] **Step 1: `HANDOFF.md`.** Add remnants (the ember and shell, black holes excluded) to the Eld relay's
  description, add `test/remnants.test.ts` and `test/remnantBuy.test.ts` to the tests list, and commit
  `HANDOFF: star destruction`.
- [ ] **Step 2: Deploy the scene** (the user signs). Run `npm run deploy -- --target-content https://worlds-content-server.decentraland.org`, then record it in HANDOFF's "Last deployed" line and commit.
- [ ] **Step 3: Put it on sale (server repo, after 062 is applied and the server plan is deployed).** In
  `src/services/blackMarket/rules.ts`, remove `offSale: true` and the "Off sale until…" comment from
  `star_destruction`. In `src/services/blackMarket/__tests__/rules.test.ts`, replace the star-destruction off-sale
  test with:

```ts
  it('sells star destruction', () => {
    expect(itemById('star_destruction')).toMatchObject({ kind: 'destroy', mana: 150 });
  });
```

  In `src/routes/__tests__/blackMarket.test.ts`, raise the catalog `toHaveLength(…)` by one. Run `npx vitest run`,
  commit `Star destruction: on sale`, and push `main` when the user says so.

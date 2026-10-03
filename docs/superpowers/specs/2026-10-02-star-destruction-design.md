# Star destruction on sale: design

The Eld's star destruction item (150 MANA) has existed on the server since migration 060, but it was kept off sale
because no map draws a destroyed star (a "supernova remnant"): a buyer would pay and see nothing happen. This puts it
on sale once the server stops serving a remnant's contents and this station's galaxy hologram draws remnants.

## What was agreed

- **Gate.** The server and this station first, then sell it. The ship scene and the iOS app draw remnants as
  follow-ons; they already can't travel to one.
- **Look.** A remnant on the hologram is a dim dark-red ember inside a faint translucent shell. It's deliberately
  smaller than any live star, to help de-crowd busy parts of the galaxy, and it has no name label. Everyone sees it
  (it isn't tied to owning anything). There's no animation.
- **Black holes can never be destroyed.** They aren't offered in the station's star picker for destruction, and the
  server refuses them as a backstop. A destroyed black hole would leave a live wormhole into a dead star, because the
  black-hole jump (`services/fuel/blackHoleWormhole.ts`) doesn't check for remnants.

## What exists already (server)

- `black_market_destroy_star(system, player, apply)` (060) checks the star and marks it `remnant_at` / `remnant_by`.
  It refuses: not found, already a remnant, has a station, someone's home, someone there, a ship inbound, pods out,
  an open or scheduled wormhole's target. Each verdict maps to an Eld-voiced message (`rules.ts` `DESTROY_REFUSALS`).
- Travel to a remnant is refused (`services/fuel/travel.ts`). Buying a wormhole to one is refused
  (`market.ts` `starInGalaxy`). The systems list returns `remnant_at`.
- Admin: `POST /api/admin/black-market/systems/:id/restore` brings a remnant back. Nothing is ever deleted.
- The station's market panel already has a star picker for `destroy`, and the picker already hides remnants.

## 1. Server (`galaxy-gardeners-server`)

### No black holes (migration `062_no_black_hole_destruction.sql`)

- `CREATE OR REPLACE FUNCTION black_market_destroy_star` is the 060 function, with one new check straight after
  `already_remnant`: `has_wormhole` → `'black_hole'`. The signature, `SECURITY INVOKER`, `search_path` and the
  `REVOKE` are unchanged. (The `SELECT … INTO sys` also reads `has_wormhole`.)
- `DESTROY_REFUSALS.black_hole = 'Even the Eld leave the black holes alone.'`

### A remnant has nothing left

- `GET /api/systems/detail/:systemId`: when the system has `remnant_at`, it responds
  `{ system, stellarBodies: [], planets: [], asteroidBelts: [], station: null, wormhole: null, remnant: true }`
  (the route's parallel queries still run, so live systems aren't slowed; their results are dropped). Other systems
  also gain `remnant: false`.
- `GET /api/planets/:systemId` returns `[]` for a remnant.
- `GET /api/planets/detail/:planetId` returns `404 { error: 'That world is gone.' }` when the planet's system is a
  remnant.
- Nothing is deleted. An admin restore brings every planet, belt and flora back as it was.

### On sale

- Remove `offSale` (and its "Off sale until …" comment) from `star_destruction`. The price (150) and blurb are
  unchanged. This ships in the same release as the station's remnant drawing.

### Tests

- pgTAP: a black hole gets `'black_hole'` and is not marked. The 060 cases still hold.
- Routes: a remnant's detail is empty with `remnant: true`, and a normal system's has `remnant: false`. The planets
  list is `[]` for a remnant. Planet detail in a remnant is a 404.
- `market` `prepare` for `destroy` on a black hole refuses with the new message (through the mocked RPC verdict).
- Catalog: `star_destruction` is on sale.

## 2. This station (`stellar-station-dcl`)

### Drawing remnants (`src/galaxyMap.ts`, shared with the ship scene)

`galaxyMap.ts` is a copy of the ship scene's file. The remnant look is added to it directly, and the ship follow-on
copies the updated file, so the two stay identical.

- `StarSystem` (`src/types.ts`) gains `remnant_at?: string | null`. The systems list already sends it.
- In `renderStarSystems`, a remnant gets:
  - Sizes: a plain star is 0.05 across (station stars 0.08, wormhole stars 0.07, home 0.12, current 0.15). A
    remnant's whole footprint, shell included, stays under a plain star's.
  - The ember: the star's own sphere at size 0.025 (half a plain star), dark red (albedo ≈ (0.35, 0.05, 0.03),
    emissive ≈ (0.5, 0.08, 0.04) at intensity 1.2), with no home pin, station halo or current-location marker.
  - The shell: a translucent sphere 0.045 across (albedo ≈ (0.8, 0.25, 0.15, 0.10), emissive at a low intensity,
    alpha blend, no collider).
  - No label. Its name is still in its system detail and in the travel refusal.
  - Everything is created once at render. Nothing is written per frame.
- A remnant is never a wormhole star on the map (black holes can't be destroyed), so it doesn't collide with the
  wormhole overlay.

### The buyer sees it at once

- When a `destroy` purchase completes at the relay (`market.ts` `settle`), the hologram reloads its stars
  (`galaxyHologram.ts` `reloadStars`, exported through a small hook so `market.ts` doesn't import the hologram).
  Other visitors see it the next time they board. The destroyed star also leaves the market's star list at once, so
  it can't be picked again before the panel is reopened.

### No black holes in the picker

- `starMatches()` (`market.ts`) leaves out stars with `has_wormhole` when the selected item is `destroy`. Other items
  (wormholes, renaming) still list them.

### Tests (vitest, the headless engine)

- A remnant renders as the ember plus the shell, with no label, station halo or home pin. Both are smaller than a
  plain star (0.05). Ticking 10 s writes no materials for it.
- The destroy picker omits black holes; the wormhole picker still includes them.
- A completed destroy purchase calls the star reload exactly once; a completed cloak purchase doesn't.

## 3 and 4. Ship scene and iOS app (follow-ons)

The ship scene copies the updated `galaxyMap.ts` and `types.ts`, and shows "nothing left" when a remnant's detail
says `remnant: true`. The iOS app draws remnants on its map, and its system detail shows "nothing left".

## Out of scope

- Destroying black holes, or anything that changes wormhole pairs.
- Live updates of other players' destructions while you're aboard (you see them on your next visit).
- Any change to the existing refusal rules other than black holes.

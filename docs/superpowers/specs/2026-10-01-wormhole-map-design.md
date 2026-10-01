# The Eld's wormhole map: design

A new item at the Eld relay (the black market behind the Space Bar). Pay once and, from then on, every map you play on
shows every known wormhole in your galaxy and where it leads. The map stays current without being bought again.

## What was agreed

- **Item.** "Wormhole map", 60 MANA, a permanent one-time purchase per player.
- **Known** means discovered by anyone in the player's galaxy.
- **What it shows.** Every linked black-hole pair. Black holes that aren't linked yet, marked as dormant. The open
  timed wormhole and any scheduled ones, with their start times. Private (exclusive) wormholes show their target and
  are marked private; their guest lists are never shown.
- **Where.** On every client: this station's projector, the ship scene's map and the iOS app. Each client is a
  separate follow-on after the server.
- **Updating.** Polling only, no sockets. An owner's client fetches when its map is shown, then every 5 minutes while
  it stays on screen. Players who don't own the map never poll.

## Background

There are two kinds of wormhole (server):

- **Black-hole wormholes.** Each black hole has one. It links permanently to the next black hole discovered in the
  same galaxy (`star_systems.has_wormhole`, `wormhole_target_id`; `services/generation/starSystem.ts`). Until then it
  is unlinked. Today a link is shown only on a single system's detail (`routes/systems.ts`).
- **Timed wormholes (events).** `wormhole_events`: a target system and a window, made by an admin or bought from the
  Eld (`bought_by`, `exclusive`, `wormhole_event_guests`). At most one per galaxy at a time, and windows don't overlap.

## Order of work

1. **Server.** Ownership, the item and the map route. The item stays `offSale` until step 2 ships.
2. **This station scene.** The projector overlay. Ships with the item put on sale. Until steps 3 and 4 ship, the item's
   blurb says the map shows on the station's projector.
3. **The ship scene** (`galaxy-gardeners-dcl`). Its own spec and plan.
4. **The iOS app** (`galaxy-gardeners-rn`). Its own spec and plan. The blurb drops "on the station's projector" once
   steps 3 and 4 are both done.

This document specifies steps 1 and 2 in full, and the contract that steps 3 and 4 build on.

## 1. Server (`galaxy-gardeners-server`)

### Catalog (`services/blackMarket/rules.ts`)

- `ItemId` gains `'wormhole_map'`, and `Item.kind` gains `'map'`.
- `{ id: 'wormhole_map', name: 'Wormhole map', mana: 60, kind: 'map', offSale: true, blurb: … }`. The blurb is
  Eld-voiced, for example "Every wormhole your galaxy has found, and where each one leads, on the station's projector.
  The Eld keep it current. Yours for good."

### Ownership (migration `061_wormhole_map.sql`)

- `wormhole_maps (player_id uuid PRIMARY KEY REFERENCES players ON DELETE CASCADE, bought_at timestamptz NOT NULL
  DEFAULT now(), granted_by uuid NULL)`. There's no purchase reference: `routes/blackMarket.ts` records the purchase
  row (and its unique `tx_hash`) only after `apply` returns, and that row already ties the player to the item.
  `granted_by` is set by an admin grant.
- RLS on and no policies (service role only, like the other black-market tables).

### Purchase flow (`services/blackMarket/market.ts`, `routes/blackMarket.ts`)

- `prepare` for `'map'`: if a `wormhole_maps` row exists for the player, throw `MarketRefusal("The Eld have already
  opened your eyes, Captain.")`. This makes quote refuse a second purchase before any MANA is sent.
- The buy route runs `prepare` again after payment, so a second payment that slipped past quote is refused there.
  It's recorded as `failed`, and the buyer is told an admin can refund it (the existing 409 path).
- `apply` for `'map'`: `insert … on conflict (player_id) do nothing`. If nothing was inserted (two payments racing
  through `prepare` at once), throw a `MarketRefusal`, which takes the same refundable path.
- `GET /api/black-market/mine` gains `wormholeMap: boolean`.

### The map route: `GET /api/black-market/wormhole-map`

It lives on the black-market router, next to `mine`, because ownership is a market concern.

- Not owned: `403 { error: 'not owned' }`.
- Owned: built fresh from current data for the player's galaxy; nothing is cached or stored.

```ts
{
  links: { a: { id, name }, b: { id, name } }[]       // each linked pair once (a.id < b.id)
  dormant: { id, name }[]                             // has_wormhole, no wormhole_target_id
  events: {
    id, target: { id, name },
    startsAt, endsAt,
    status: 'open' | 'scheduled',                     // ended events are left out
    exclusive: boolean, eldBuilt: boolean
  }[]
}
```

- Remnant systems (`remnant_at` set) are left out of `links` and `dormant`. A pair with one remnant end is left out
  entirely.
- Only the player's own galaxy is included.
- There's no change timestamp (neither `star_systems` nor `wormhole_events` has an `updated_at`). Clients compare
  the response content to decide whether to redraw.

### Admin

- Map purchases appear in the existing `GET /api/admin/black-market/purchases`.
- New: `POST /api/admin/black-market/wormhole-map/:playerId/grant` and `/revoke`, for refunds and for comps.

### Tests

- pgTAP: the table exists, its RLS is on, and deleting a player cascades.
- Routes: quote refuses an owner. Buying inserts ownership. A racing second apply is marked refundable. `mine` reports
  `wormholeMap`. The map route returns 403 when not owned. Link pairs are deduplicated. Dormant black holes are
  listed. Ended events are dropped and scheduled ones kept. Remnants are excluded. Other galaxies are excluded. Grant
  and revoke work.

## 2. This station scene (`stellar-station-dcl`)

### Buying

- `stationApi.ts`: `MarketItem.kind` gains `'map'`; `getMarketMine` returns `wormholeMap`; a new
  `getWormholeMap()` returns the response above, or `null` on 403.
- The Eld's panel (`blackMarket/panelUi.tsx`, `market.ts`) lists it from the catalog. It takes no parameters: quote,
  then pay. When owned, it shows "Owned" and the buy button is disabled. The "mine" line adds "Wormhole map".
- A completed purchase tells the overlay to start straight away; there's no reload.

### The overlay: `src/wormholeMap.ts`

It mirrors `src/heatMap.ts`: it registers through `addMapRenderHooks`, draws under the galaxy root, and is cleared with
the map. Each visitor draws the projector locally, so only owners see the overlay.

- **Linked pair.** A thin violet beam (a cylinder stretched between the two stars, emissive, no collider).
- **Dormant black hole.** A small, dim, broken ring (four short arc pieces) around the star.
- **Open timed wormhole.** A brighter beam from the galaxy's centre to the target, pulsing. Gold-tinted when the Eld
  built it.
- **Scheduled timed wormhole.** A faint, dashed beam (short segments) from the centre to the target.
- **Private.** The target end gets a small cap in a distinct colour, so the marking doesn't rely on colour alone.
- **Hover.** Pointing at a black hole adds "⇄ <other end>" or "dormant" to its existing hover text, and pointing at a
  timed wormhole's target adds "wormhole open until HH:MM" or "wormhole opens HH:MM".
- **The pulse.** Material writes happen at most ten times a second, and only on the open event's beam.
- **Toggle.** A "Wormholes" toggle next to the heat map toggle in the projector controls, saved through `prefs.ts`. It
  defaults to on, and is shown only to owners.

### Polling

- Ownership comes from `getMarketMine` once the player is signed in. If they don't own the map, nothing polls.
- When the player owns it: fetch when the galaxy view is shown, then every 5 minutes while it stays shown. Never more
  than one request in flight. Nothing is fetched in the system view or while the toggle is off.
- Redraw only when the content has changed. An unchanged poll writes no entities or materials.
- A 403 marks the map not owned (revoked), clears the overlay and stops polling. A network error keeps what's drawn.

### Tests (vitest, the headless engine)

- Not owned: no overlay entities and no map requests.
- Owned: one beam per pair, one ring per dormant black hole, and one beam per event, dashed when scheduled.
- An unchanged second poll: no Transform or Material writes.
- One request in flight: a slow response doesn't stack a second request.
- System view or toggle off: no polling. Back to the galaxy view: one fetch.
- A 403 after owning: the overlay is cleared and polling stops.

## 3 and 4. Ship scene and iOS app (follow-ons)

Each one reads `wormholeMap` from `/mine`, polls `GET /api/black-market/wormhole-map` under the same rules (on show,
then every 5 minutes while shown, one in flight, and stop on 403), and draws the same four markings in its own style.
Each gets its own spec and plan once step 2 has shipped.

## Out of scope

- Push or socket updates. Polling is enough, because wormholes change slowly.
- Showing guest lists, other galaxies, or wormhole history.
- Any change to who can jump. The map shows wormholes; it never opens them.
